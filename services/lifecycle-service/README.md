# @vellar/lifecycle-service

Account inspection, blocker detection, cleanup planning, merge validation

## Async Cleanup Job Queue (Issue #293)

The lifecycle-service implements an **async cleanup job queue with per-account FIFO ordering guarantees**. This ensures that cleanup jobs for the same Stellar account are always processed in creation order, preventing inconsistent final account state from concurrent or out-of-order processing.

### Architecture

**Synchronous HTTP API** (stateless):
- `POST /lifecycle/inspect` — read account state from Horizon
- `POST /lifecycle/plan` — inspect blockers and merge readiness
- `POST /lifecycle/execute` — enqueue job or return unsigned XDR (if no queue)
- `POST /lifecycle/merge` — validate merge preconditions

**Async Worker** (when `DATABASE_URL` is set):
- Polls the `cleanup_jobs` queue table
- Claims jobs in per-account FIFO order (see below)
- Builds unsigned cleanup transactions
- Detects out-of-order processing attempts (metric)
- Completes or fails each job

### Per-Account FIFO Ordering Guarantee

**The guarantee**: Jobs for the same account are always processed in the order they were submitted, regardless of how many workers are running or how they race.

**Enforcement mechanism**:

1. **Database ordering**: Claim query orders by `(account_id, created_at ASC)`
   ```sql
   SELECT id FROM cleanup_jobs
   WHERE status = 'queued'
   ORDER BY account_id ASC, created_at ASC
   LIMIT :limit
   FOR UPDATE SKIP LOCKED
   ```
   The `FOR UPDATE SKIP LOCKED` ensures atomic claiming — multiple workers will never claim the same job.

2. **Sequence number tracking**: Each job knows its 1-based sequence number within its account:
   ```
   job-1 for account A (sequence=1)
   job-2 for account A (sequence=2)
   job-1 for account B (sequence=1)
   ```
   The sequence number is calculated at enqueue time and returned to the client.

3. **Out-of-order detection**: The worker tracks the expected sequence number per account. If a job arrives out of sequence, the metric `vela_cleanup_out_of_order_total` is incremented and logged.

4. **No global serialization**: Different accounts are processed in parallel. Only jobs for the same account are serialized.

### Why This Matters

**Without per-account ordering**, concurrent workers could process cleanup jobs like this:
```
Worker-1 claims: job-2 for account A (delete data)
Worker-2 claims: job-1 for account A (cancel offers)
Worker-2 completes: job-1 first (offers already deleted)
Worker-1 tries: job-2 on account with no data (fails or succeeds incorrectly)
Result: account in inconsistent state
```

**With per-account FIFO**, jobs are always processed in dependency order:
```
Worker-1 claims: job-1 for account A (cancel offers) + job-2 for account B
Worker-2 claims: job-1 for account B (cancel offers) + job-3 for account A
Processing order: A1 → B1 → B2 → A2
(Within account A: 1 before 2; within account B: 1 before 2)
Result: consistent, predictable state
```

### Configuration

**To enable async cleanup queue**:
```bash
export DATABASE_URL="postgres://localhost/vellar"
npm run start          # HTTP API with async queue integration
```

**To run the cleanup worker** (separate process):
```bash
export DATABASE_URL="postgres://localhost/vellar"
export LIFECYCLE_WORKER_PORT=4006
npm run worker        # (or: tsx src/worker/index.ts)
```

**To run in sync-only mode** (no database, no worker):
```bash
npm run start          # HTTP API returns unsigned XDR immediately
```

### API Examples

**Async mode** (with queue):
```bash
curl -X POST http://localhost:4002/lifecycle/execute \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5V3GQ",
    "destination": "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBY4R7JQ"
  }'

# Response (202 Accepted):
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "sequenceNumber": 3,
  "status": "queued",
  "message": "Cleanup job queued for processing. Poll GET /lifecycle/jobs/:jobId for status."
}
```

**Sync mode** (no queue):
```bash
# Response (200 OK, immediate XDR):
{
  "steps": [
    { "xdr": "AAAAAgAAA...", "title": "1/2: Cancel offers" },
    { "xdr": "AAAAAgAAA...", "title": "2/2: Pay and merge" }
  ],
  "plan": {
    "blockers": [],
    "mergeReady": true,
    "estimatedTransactions": 2
  }
}
```

### Monitoring

**Prometheus metrics**:
- `vela_cleanup_jobs_claimed_total` — jobs claimed for processing
- `vela_cleanup_jobs_completed_total` — jobs successfully completed
- `vela_cleanup_jobs_failed_total` — jobs failed (invalid input, account not found)
- `vela_cleanup_out_of_order_total` — out-of-order processing attempts detected

**Alert on out-of-order**: If `vela_cleanup_out_of_order_total` increases, it indicates either:
1. A bug in the claim query ordering
2. Multiple workers racing (though `FOR UPDATE SKIP LOCKED` should prevent this)
3. A job was retried while another job for the same account was being claimed
4. Database corruption or concurrent DDL

### Database Schema

```sql
CREATE TABLE cleanup_jobs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  destination TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'dead_letter')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
  record JSONB NOT NULL  -- full job record (steps, plan, error, attempts)
);

-- Per-account FIFO ordering index
CREATE INDEX cleanup_jobs_account_created_idx ON cleanup_jobs (account_id, created_at ASC);
CREATE INDEX cleanup_jobs_status_idx ON cleanup_jobs (status);
```

### Testing

Run the concurrency test to verify per-account FIFO ordering under concurrent workers:
```bash
npm run test -- loop.test.ts
```

Test suites:
1. **Per-account FIFO ordering** — jobs for same account processed in order
2. **Multi-account parallel processing** — different accounts don't block each other
3. **Job failure handling** — invalid jobs fail gracefully; batch continues
4. **Out-of-order metric tracking** — metric incremented on ordering violations
5. **Batch claiming** — respects batch size limits

### Implementation Notes

**Why Postgres-backed queue over Redis/BullMQ?**
- Minimal infrastructure: no separate broker
- Atomic claiming via `FOR UPDATE SKIP LOCKED` (no distributed lock needed)
- Full job record stored as JSONB (rich audit trail)
- Leverages existing Postgres connection (same DB as verification-service)
- Matches verification-service pattern for consistency

**Why not lock-free concurrency?**
- Per-account serialization is enforced by claim ordering + database atomicity
- Workers don't contend on the same job; they claim disjoint batches
- Out-of-order detection is a monitoring concern, not a correctness concern
- Simplifies recovery: a failed job simply returns to 'queued' and is retried

### Future Enhancements

1. **Job status polling**: Add `GET /lifecycle/jobs/:jobId` to poll completion
2. **Backoff strategy**: Exponential backoff with jitter for retries (like verification-service)
3. **Dead-letter DLQ**: Move jobs to dead-letter after max retries
4. **Per-worker load balancing**: Rebalance batch size based on worker capacity
5. **Audit logging**: Full history of job transitions and errors in JSONB record

