# @vellar/worker-service

The deterministic contract-verification build worker (technical-doc.md §8.4).

It runs as its **own isolated process** — never co-located with the wallet/policy
services that hold sponsor keys, because it executes untrusted, submitter-provided
build inputs. It shares only the `verification_records` Postgres table with
`verification-service`: it claims `submitted` rows, rebuilds the contract,
compares the rebuilt wasm hash to the **on-chain** deployed hash, and writes
`verified` / `failed`.

## Two build modes (the 1A seam — see docs/decisions.md)

The build step is a pluggable `BuildExecutor`, chosen at startup from env:

| `VERIFY_BUILD_IMAGE` | Executor                                                                                   | Where                       |
| -------------------- | ------------------------------------------------------------------------------------------ | --------------------------- |
| **unset**            | `stubBuildExecutor` — deterministic synthetic bytes; never falsely matches a real contract | CI / free-tier host         |
| **set**              | `dockerBuildExecutor` — real hermetic Soroban build in the image                           | a Docker-equipped build box |

## Running the REAL Docker build

Real Rust/Soroban builds can't run in CI or on the free-tier host — they need
Docker + a pinned toolchain image. Here's the full local runbook.

### 1. Build the toolchain image (once)

From the **repo root**:

```sh
docker build -f infra/docker/verification-builder.Dockerfile -t vela-verify:1.94.0 .
```

The image pins Rust 1.94.0 + the `wasm32v1-none` target + Stellar CLI 26.1.0 to
match `contracts/rust-toolchain.toml` and `contracts/Cargo.toml`. **Those pins
are the reproducibility contract** — changing them changes output hashes.

### 2. Start the backend + a Postgres

The worker needs the same `DATABASE_URL` as `verification-service`. Locally:

```sh
docker compose -f infra/docker/docker-compose.yml up -d   # Postgres on :5433
# start the API side (gateway + verification-service) however you run the backend,
# e.g. the combined process:
pnpm --filter @vellar/all-in-one start
```

### 3. Start the worker pointed at the image

```sh
DATABASE_URL=postgres://vela:vela@localhost:5433/vela \
VERIFY_BUILD_IMAGE=vela-verify:1.94.0 \
STELLAR_RPC_URL=https://soroban-testnet.stellar.org \
pnpm --filter @vellar/worker-service start
```

On boot it logs `using the Docker build executor (image=vela-verify:1.94.0)`.
(Without `VERIFY_BUILD_IMAGE` it logs the STUB warning instead.)

### 4. Submit a contract for verification

Through the gateway (`:4000` by default):

```sh
curl -sX POST http://localhost:4000/verification/submit \
  -H 'content-type: application/json' \
  -d '{
    "contractId": "C...",                     // the DEPLOYED contract address
    "sourceType": "repo",
    "repoUrl": "https://github.com/org/contract",
    "commitHash": "<full-or-short-sha>",
    "toolchainVersion": "1.94.0",
    "buildFlags": []
  }'
```

Or use the web app: **/verify → Submit for verification**.

### 5. Watch it verify

```sh
curl -s http://localhost:4000/verification/C.../status
# → {"status":"submitted"}  then  "building"  then  "verified" | "failed"
```

`verified` means the rebuilt wasm hash is byte-for-byte the deployed one. The
full record (`GET /verification/C...`) carries both hashes and the build log.

## Reproducibility model: the container is the source of truth

Rust/Soroban wasm builds are **not bit-identical across build hosts** (LTO/codegen
makes different valid choices on macOS vs Linux vs a different CLI git build),
even with pinned toolchain + lockfile + profile. We proved this concretely:
a macOS-local build of our spending-limit contract and a Linux-container build
of the SAME source produce semantically-identical but byte-different wasm
(docs/decisions.md 2026-07-20).

So verification uses a **canonical build environment**: the image below is
internally deterministic (two clean builds are byte-identical), and **the
deployed on-chain artifact IS the image's output**. The rule:

> **Any contract we want to be verifiable MUST be built AND deployed through the
> canonical image — never from a developer's local host.**

Deploying a contract for verification is therefore:

```sh
# 1. build in the canonical image (deterministic)
docker run --rm -v "$(pwd)/contracts:/work" -w /work vela-verify:1.94.0 \
  stellar contract build
# 2. upload THOSE EXACT bytes (never re-optimize — build already optimized)
stellar contract upload \
  --wasm contracts/target/wasm32v1-none/release/<name>.wasm \
  --optimize=false \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  --source-account <funded-identity>
```

`--optimize=false` is REQUIRED: `stellar contract build` already optimizes, so
the verifier hashes the optimized bytes; re-optimizing on upload would change the
hash. Our spending-limit contract verifies byte-for-byte this way
(`0f6b858d…`, tx `6f83e098…`).

## Honest limitations (Phase 7 hardening)

- **Third-party contracts** are verifiable only when the author built with a
  matching toolchain. A metadata-tolerant comparison (normalize the
  `contractmetav0` `rsver`/`rssdkver`/`cliver` stamp) would widen this — a Phase 7
  nice-to-have, no longer a blocker for OUR contracts.
- The Docker build runs with **`--network=none`** (hermetic — no mid-build
  fetches, required for determinism). A repo whose dependencies aren't vendored
  or pre-fetched will fail the build under network isolation. Vendoring /
  lockfile-pinned dependency pre-fetch is Phase 7 work.
- A multi-contract workspace emits several wasms; such submissions must set
  `expectedWasmPath` to disambiguate (the resolver refuses to guess).

## Build sandbox (§8.4)

Builds run UNTRUSTED, submitter-provided code, so `docker run` is locked down:
`--network=none` (hermetic, no exfiltration), `--memory`/`--cpus`/`--pids-limit`
(resource + fork-bomb caps), `--read-only` root FS with a writable `--tmpfs /tmp`,
`--cap-drop=ALL`, `--security-opt no-new-privileges`, `--user 1000:1000`
(non-root) — plus an enforced build timeout that SIGKILLs a hung build. All caps
are env-tunable (see below). **Signed job payloads are intentionally not
implemented** — there is no untrusted queue between the service and the worker
(the shared Postgres is the trust boundary); see docs/decisions.md.

## Env

| Var                       | Purpose                                                        | Default |
| ------------------------- | -------------------------------------------------------------- | ------- |
| `DATABASE_URL`            | shared verification store (REQUIRED — worker exits without it) | —       |
| `VERIFY_BUILD_IMAGE`      | toolchain image → real Docker builds; unset → stub             | unset   |
| `STELLAR_RPC_URL`         | RPC for reading the deployed wasm hash                         | testnet |
| `VERIFY_POLL_IDLE_MS`     | poll interval when the queue is idle                           | 5000    |
| `VERIFY_BUILD_TIMEOUT_S`  | kill a build after this many seconds                           | 600     |
| `VERIFY_BUILD_MEMORY`     | container memory cap (docker `--memory`)                       | 2g      |
| `VERIFY_BUILD_CPUS`       | container CPU cap (docker `--cpus`)                            | 2       |
| `VERIFY_BUILD_PIDS_LIMIT` | max processes in the container                                 | 512     |

## Automatic Retry with Backoff for Transient Failures (Issue #295)

The worker automatically retries verification jobs that fail due to transient
infrastructure issues (network timeouts, RPC rate limits, temporary server
unavailability) while immediately marking genuinely permanent failures as failed
to avoid wasting resources.

### Transient vs Permanent Classification

**Transient failures (automatically retried with exponential backoff)**:
- **Network-level errors**: timeouts, connection resets, DNS failures
- **RPC rate-limiting**: "too many requests", HTTP 429 responses
- **RPC server unavailability**: temporary server errors (5xx), nodes syncing or not ready
- **Build timeouts**: Docker build timeout or temporary resource constraint
- **Git service issues**: clone/checkout failures (may recover if git service recovers)

**Permanent failures (immediately marked failed, NOT retried)**:
- **Contract not found on-chain**: contract address doesn't exist or wrong network
- **Stellar Asset Contract (SAC)**: contract is a built-in token, no user source to verify
- **Source/bytecode mismatch**: rebuilt wasm doesn't match deployed wasm (verification failure)
- **Invalid input**: malformed contract address, unsupported source type
- **Configuration errors**: build executor not set up, SSRF-rejected repository URL
- **Build infrastructure errors**: missing expected artifact, build configuration broken

### Retry Behavior

Each transient failure outcome includes:
- `isRetryable: true` — indicates the error is retryable
- `retryDelayMs` — exponential backoff delay (with jitter) before the next attempt
- `retryAttempt` — the 0-based attempt number for this job

The backoff follows exponential growth with full jitter to prevent thundering herd:

```
Attempt 0: delay ∈ [0, 1000]ms         (first RPC call)
Attempt 1: delay ∈ [0, 2000]ms         (after first backoff)
Attempt 2: delay ∈ [0, 4000]ms         (after second backoff)
Attempt N: delay ∈ [0, min(cap, base*2^N)]ms  (capped at 30s)
```

After exhausting all retry attempts (default 3 retries + 1 initial = 4 total
attempts), the job is moved to `dead_letter` status and never retried again.

### Idempotency

Verification jobs are naturally idempotent — re-running verification against the
same contract doesn't cause harmful side effects:
- The rebuilt wasm hash is deterministic (same input → same output)
- Multiple verification attempts produce the same comparison result
- Each attempt is independent (no state accumulated across retries)

This means a transient failure followed by a retry and success produces the
correct final outcome with no conflicts or duplicates.

### Metrics

The worker emits a `verification_retry` metric tracking how many retry attempts
were required:
- `verificationRetry(retryCount, finalOutcome)` — emitted when a job completes
  after transient retries
- `retryCount` — number of retry attempts (0 = no retries, first-attempt success)
- `finalOutcome` — "verified" or "failed"

Use this metric to understand retry patterns and detect systemic RPC reliability
issues (e.g. if retry counts spike, it may indicate an RPC outage or network
congestion).

### Implementation

The classification is implemented in `error-classification.ts`:
- `isTransientFailure(error): boolean` — determines if an error is retryable
- `classifyError(error): ErrorClassificationResult` — detailed classification with reasoning

Retry delays are calculated using the existing `calculateBackoffDelay()` utility
from `backoff.ts`, reusing the same exponential backoff + jitter logic as the
M7 reaper for consistency.

