# @vellar/service-kit

Shared backend service bootstrap: health route, startup, graceful shutdown. Extracted once the second real service existed (see docs/decisions.md) so every `services/*` server stays consistent without copy-paste.

---

## Modules

### `registerHealth` / `startService`

Standard Fastify health-check route and graceful-shutdown wiring. See `src/index.ts`.

### `registerMetrics` / `recordOutcome`

Prometheus metrics (HTTP + domain counters). See `src/metrics.ts`.

### `resolvePersistencePolicy`

Fail-closed boot policy for the database layer. See `src/persistence.ts`.

### `resolveNetwork`

Explicit `STELLAR_NETWORK` resolution with cross-checks against passphrase and RPC URL. See `src/network-config.ts`.

### `SpendBudget` / `createPgSpendBudget`

Rolling-window spend budgets for the sponsor/deploy/create funding paths. See `src/budget.ts` and `src/pg-budget.ts`.

---

## `retryWithBackoff`

A general-purpose retry utility with **exponential back-off and full jitter** (issue #352). Use it anywhere an operation may fail transiently — RPC calls, Horizon HTTP fetches, DB writes under contention.

### API

```ts
import { retryWithBackoff, MaxRetriesExceededError, RetryAbortedError } from "@vellar/service-kit";

const result = await retryWithBackoff(fn, options);
```

**Parameters**

| Option | Type | Default | Description |
|---|---|---|---|
| `maxAttempts` | `number` | `4` | Total attempts (including the first call). Must be ≥ 1. |
| `baseDelayMs` | `number` | `200` | Base delay in ms. The ceiling for attempt N is `baseDelayMs × 2^N`. |
| `maxDelayMs` | `number` | `10 000` | Hard ceiling on any single sleep interval. |
| `noJitter` | `boolean` | `false` | When `true`, uses the full computed ceiling rather than a random value in `[0, cap]`. Only disable for deterministic tests. |
| `isRetryable` | `(err: unknown) => boolean` | `() => true` | Return `false` to surface an error immediately without further retries (e.g. 4xx HTTP errors). |
| `signal` | `AbortSignal` | — | Cancels pending retries. Throws `RetryAbortedError` when fired. |
| `sleep` | `(ms: number) => Promise<void>` | `setTimeout`-based | Override the sleep implementation (tests pass a zero-delay stub). |

**Thrown errors**

- `MaxRetriesExceededError` — all attempts exhausted. `.cause` is the last thrown error.
- `RetryAbortedError` — the `AbortSignal` fired between attempts.
- Any error for which `isRetryable` returned `false` — propagated as-is.

### Backoff formula

```
cap(N) = min(maxDelayMs, baseDelayMs × 2^N)   // N = 0-indexed attempt number
delay  = random(0, cap(N))                     // full jitter
```

Full jitter is recommended for production because it spreads retry storms across the window rather than synchronising all callers at the ceiling ([AWS Architecture Blog](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)).

### Examples

**Basic usage — retry a flaky RPC call**

```ts
import { retryWithBackoff } from "@vellar/service-kit";

const txStatus = await retryWithBackoff(() => rpcClient.getTransaction(hash), {
  maxAttempts: 5,
  baseDelayMs: 300,
  maxDelayMs: 3_000,
});
```

**Skip retries for permanent errors**

```ts
import { retryWithBackoff } from "@vellar/service-kit";

const data = await retryWithBackoff(() => fetchFromHorizon(url), {
  maxAttempts: 3,
  isRetryable: (err) => {
    // Abort immediately on 4xx — these are permanent client mistakes.
    if (err instanceof HttpError && err.status >= 400 && err.status < 500) return false;
    return true; // retry network errors and 5xx
  },
});
```

**Cancellable retry**

```ts
import { retryWithBackoff, RetryAbortedError } from "@vellar/service-kit";

const controller = new AbortController();
setTimeout(() => controller.abort(), 30_000); // overall deadline

try {
  const result = await retryWithBackoff(() => doWork(), {
    signal: controller.signal,
  });
} catch (err) {
  if (err instanceof RetryAbortedError) {
    // Cancelled — clean up.
  }
  throw err;
}
```

**Test-friendly — inject a zero-delay sleep**

```ts
import { retryWithBackoff } from "@vellar/service-kit";

it("retries on transient failure", async () => {
  let calls = 0;
  const result = await retryWithBackoff(
    async () => {
      if (++calls < 3) throw new Error("transient");
      return "ok";
    },
    { sleep: async () => {} }, // no real waiting in tests
  );
  expect(result).toBe("ok");
  expect(calls).toBe(3);
});
```
