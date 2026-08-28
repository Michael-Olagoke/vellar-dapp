# @vellar/wallet-service

Wallet metadata, account preferences, session/device records, audit logs


## Exactly-Once Transaction Submission Worker (Issue #291)

The wallet-service includes an optional transaction submission worker that implements **exactly-once processing** for transaction submissions to the blockchain. This prevents duplicate transaction submissions when the queue redelivers messages due to network retries, worker crashes, or visibility timeouts.

### Architecture

The worker uses a PostgreSQL-based processed-message store to track submission state with the following sequence:

1. **Receive** message from queue (do NOT ack yet)
2. **Check** processed-message store:
   - If already PROCESSED → skip (duplicate) → ack
   - If IN_FLIGHT → skip (another worker handling) → ack
   - If not present → continue
3. **Mark IN_FLIGHT** (atomic SET NX using INSERT ON CONFLICT DO NOTHING)
   - If conflict → another worker claimed it → ack and skip
4. **Submit** transaction to blockchain
5. On success:
   - Mark PROCESSED (48-hour TTL)
   - Ack message
6. On transient failure:
   - Clear IN_FLIGHT lock
   - Do NOT ack → queue redelivers
7. On permanent failure:
   - Mark FAILED
   - Ack message (do not retry)

### Error Classification

Errors are classified as **transient** (retryable) or **permanent** (terminal):

**Transient** (retry with backoff):
- Network timeouts, connection errors, DNS failures
- RPC rate limits (HTTP 429, 5xx), temporary unavailability
- Sponsor submission transient failures

**Permanent** (no retry):
- Invalid transaction (sponsor_bad_tx, sponsor_simulation_failed)
- Budget exceeded (sponsor_fee_too_high, sponsor_budget_exceeded)
- On-chain failure (tx_failed)
- Configuration errors (relayer_not_configured)

### TTL Configuration

**IN_FLIGHT TTL: 5 minutes**
- Covers max submission latency + redelivery delay
- [VERIFY] before deployment: ensure 5 minutes > p99 submission latency + queue visibility timeout

**PROCESSED TTL: 48 hours**
- Deduplicates redelivered messages within this window
- [VERIFY] before deployment: ensure 48 hours ≥ 2 × queue message retention period

### Residual Risk

If a worker crashes AFTER submission but BEFORE writing PROCESSED:
1. Message redelivered by queue
2. IN_FLIGHT record detected if TTL not expired (safe dedup)
3. If IN_FLIGHT TTL expired AND message redelivered → potential duplicate submission

**Probability is low** because IN_FLIGHT TTL (5 min) > typical queue visibility timeout (~30 sec). Duplicate submission requires:
- Worker crash after submission
- IN_FLIGHT TTL to expire (5 min)
- Message to be redelivered before TTL expires
- All three conditions to coincide

**Mitigation**: Set TTL conservatively, monitor submission latency, alert on unexpectedly long submissions.

### Fail-Closed Policy

**If the store (database) is unavailable:**
- Do NOT submit transaction
- Do NOT ack message
- Let queue redeliver after visibility timeout

**Reasoning**: For financial transactions, delayed submission is safer than duplicate submission. Better to wait for store recovery than risk losing the idempotency guarantee.

### Polling Configuration

- **POLL_IDLE_MS**: 5000ms (delay when queue empty)
- **POLL_BUSY_MS**: 250ms (fast re-poll when work found)
- **REAP_INTERVAL_MS**: 5 minutes (periodic cleanup of expired records)

### Metrics

The worker emits:
- `submissionResult(outcome, durationMs)`: every attempt outcome (success or permanent failure)
- `submissionRetry(transactionId, retryCount, finalOutcome)`: outcomes after transient retries
- `workerFailure(error)`: unexpected errors (DB down, etc.)

### Integration

The worker complements the current synchronous submission flow:

**Current (Synchronous):**
```
POST /wallet/submit → Immediate response (hash or error)
```

**With Worker (Optional, Asynchronous):**
```
POST /wallet/submit-queued → 202 Accepted
Worker Poll → Claim → Submit → Update status
GET /wallet/submission/:transactionId → Check status
```

The synchronous path remains unchanged; the worker provides an alternative for scenarios requiring guaranteed retry semantics.

### Testing

Comprehensive test suite in `src/worker/submission-worker.test.ts` covers:
- Error classification (transient vs permanent)
- Duplicate detection and in-flight handling
- Transient/permanent error behavior
- Idempotency guarantees
- Exactly-once processing
- Error handling and metrics
- TTL configuration

All tests use mocked store and submitter for isolation.

### Files

- `src/db/schema.ts` — `transactionSubmissions` table schema
- `src/db/pg-tx-store.ts` — Store operations (check, mark, cleanup)
- `src/submission-error-classifier.ts` — Error classification logic
- `src/worker/submission-worker.ts` — Worker polling loop
- `src/worker/submission-worker.test.ts` — Comprehensive test suite
- `../../docs/exactly-once-worker.md` — Full documentation

### Configuration

All constants are configurable via environment variables or function parameters:
- `IN_FLIGHT_TTL_MS`: 5 minutes
- `PROCESSED_TTL_MS`: 48 hours
- `MAX_SUBMISSION_ATTEMPTS`: 3
- `POLL_IDLE_MS`: 5000ms
- `POLL_BUSY_MS`: 250ms
- `REAP_INTERVAL_MS`: 5 minutes

See `docs/exactly-once-worker.md` for [VERIFY] checklist before deployment.
