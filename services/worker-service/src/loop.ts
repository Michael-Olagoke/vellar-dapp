import type { Attestor } from "./attestor";
import type { VerificationJobStore } from "./job-store";
import { runVerification, type RunVerificationDeps } from "./verify";

// The build worker's poll loop. Claims submitted jobs, runs each to a terminal
// outcome, and records the result. Kept separate from process/timer wiring so a
// single "tick" is testable deterministically.

/** Observability hook (idea.md §13): the loop reports each verification outcome
 * + turnaround and any unexpected worker failure. Optional + defaulted so the
 * loop stays a pure, injectable unit in tests.
 *
 * ISSUE #295: Added verificationRetry metric to track retry attempts for jobs
 * that succeeded or failed after transient errors. */
export interface WorkerMetrics {
  verificationResult(outcome: "verified" | "failed", turnaroundSeconds?: number): void;
  workerFailure(): void;
  /** Emitted when a job succeeds or fails after one or more transient retries.
   * Allows tracking how many retry attempts were required. */
  verificationRetry?(retryCount: number, finalOutcome: "verified" | "failed"): void;
}

const noopMetrics: WorkerMetrics = { verificationResult: () => {}, workerFailure: () => {} };

export interface WorkerDeps extends RunVerificationDeps {
  store: VerificationJobStore;
  /** Max jobs to claim per tick. */
  batchSize?: number;
  log?: { info: (msg: string) => void; error: (msg: string, err?: unknown) => void };
  metrics?: WorkerMetrics;
  /** Optional on-chain attestation mirror. Called after each outcome is
   * persisted; the attestor swallows its own errors, so attestation can never
   * fail or retry a verification job. */
  attestor?: Attestor;
}

const silentLog = { info: () => {}, error: () => {} };

/**
 * Processes one batch of claimed jobs. Returns how many jobs were handled so a
 * caller can decide whether to poll again immediately (queue busy) or back off
 * (idle). A single job failing (unexpected throw) is logged and does not abort
 * the rest of the batch — the record is left "building" and re-claimable after
 * a timeout in production (retryable per idea.md §13).
 *
 * ISSUE #295: Tracks retry attempts via outcome.retryAttempt and emits
 * verificationRetry metric when a job completes after retries.
 */
export async function runWorkerTick(deps: WorkerDeps): Promise<number> {
  const log = deps.log ?? silentLog;
  const metrics = deps.metrics ?? noopMetrics;
  const jobs = await deps.store.claimSubmitted(deps.batchSize ?? 1);
  for (const job of jobs) {
    try {
      // Pass the job's attempt count from the record (tracked in jsonb by the store)
      const retryAttempt = (job.record?.attempts ?? 1) - 1; // Convert attempt count to 0-based retry attempt
      const outcome = await runVerification(job, {
        executor: deps.executor,
        resolver: deps.resolver,
        retryAttempt,
      });
      await deps.store.complete(job.recordId, outcome);
      const turnaround =
        job.submittedAtMs !== undefined ? (Date.now() - job.submittedAtMs) / 1000 : undefined;
      metrics.verificationResult(outcome.status, turnaround);

      // Emit retry metric if this job was retried
      if (outcome.retryAttempt && outcome.retryAttempt > 0 && metrics.verificationRetry) {
        metrics.verificationRetry(outcome.retryAttempt, outcome.status);
      }

      log.info(`verification ${job.recordId} → ${outcome.status} (${job.contractId})`);
      // Mirror the outcome on-chain (best-effort; never throws).
      if (deps.attestor) await deps.attestor.reportOutcome(job.contractId, outcome);
    } catch (err) {
      // runVerification only throws on truly unexpected errors; leave the record
      // "building" so it can be retried, and keep processing the batch.
      metrics.workerFailure();
      log.error(`verification ${job.recordId} errored unexpectedly`, err);
    }
  }
  return jobs.length;
}

export interface WorkerLoopHandle {
  stop(): void;
}

/**
 * Runs the tick loop on an interval. When a tick finds work it polls again
 * quickly; when idle it waits `idleDelayMs`. Returns a handle to stop it.
 */
export function startWorkerLoop(
  deps: WorkerDeps & { idleDelayMs?: number; busyDelayMs?: number },
): WorkerLoopHandle {
  const idleDelayMs = deps.idleDelayMs ?? 5000;
  const busyDelayMs = deps.busyDelayMs ?? 250;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (ms: number) => {
    if (stopped) return;
    timer = setTimeout(tick, ms);
  };

  const tick = async () => {
    if (stopped) return;
    let handled = 0;
    try {
      handled = await runWorkerTick(deps);
    } catch (err) {
      (deps.log ?? silentLog).error("worker tick failed", err);
    }
    schedule(handled > 0 ? busyDelayMs : idleDelayMs);
  };

  schedule(0);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
