import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { BudgetLimits, ConsumeRequest, ConsumeResult, SpendBudget } from "./budget";

// Postgres-backed rolling-window spend budget (security-audit.md H1/M2/FIX 3).
// Shared by every funding-path service (wallet + policy) so the serialized
// check-and-record lives in ONE place. Each service owns its own spend_ledger
// migration; this only needs a drizzle-style executor with transactions.
//
// RA-2: a single conditional-INSERT is NOT enough. Under READ COMMITTED (the
// pool default), the aggregate CTE reads a committed snapshot that cannot see
// other in-flight uncommitted inserts, so N concurrent same-key requests each
// read the same sum, all pass the WHERE, and all commit — overshooting the
// ceiling by the pool-concurrency factor. So the check+insert runs inside a
// TRANSACTION guarded by pg_advisory_xact_lock keyed on (line, network), taken
// BEFORE the aggregate read: same-key callers serialize on the lock (auto-
// released at commit); different keys never block each other. Keyed off the
// network the CALLER passes (server config, never a request body — V5). Throws
// on a DB error; callers treat a throw as "refuse" (fail closed).

/** Minimal structural view of a drizzle db — the budget needs a transaction so
 * the advisory lock and the check-insert share one connection/transaction. */
export interface BudgetTx {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}
export interface BudgetDb {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
  transaction<T>(fn: (tx: BudgetTx) => Promise<T>): Promise<T>;
}

export interface PgBudgetConfig {
  windowMs: number;
  limits: Record<ConsumeRequest["line"], BudgetLimits>;
  now?: () => Date;
}

export function createPgSpendBudget(db: BudgetDb, config: PgBudgetConfig): SpendBudget {
  const now = config.now ?? (() => new Date());

  return {
    async tryConsume(req: ConsumeRequest): Promise<ConsumeResult> {
      const limits = config.limits[req.line];
      const addCount = req.count ?? 1;
      const windowStart = new Date(now().getTime() - config.windowMs);
      const id = randomUUID();
      const at = now();
      const maxStroops = limits.maxStroops ?? null; // null => count-only line

      const result = await db.transaction(async (tx) => {
        // Serialize same-(line,network) callers BEFORE the aggregate read.
        // hashtext(line||network) → a stable int4 lock key; the xact-scoped lock
        // releases automatically at commit/rollback. Different keys use
        // different lock ids and never block each other.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`${req.line}:${req.network}`}))`,
        );
        return tx.execute(sql`
          WITH agg AS (
            SELECT
              COALESCE(SUM(stroops), 0)::numeric AS sum_stroops,
              COALESCE(SUM(count), 0)::int      AS sum_count
            FROM spend_ledger
            WHERE line = ${req.line}
              AND network = ${req.network}
              AND at > ${windowStart}
          )
          INSERT INTO spend_ledger (id, line, network, stroops, count, at)
          SELECT ${id}, ${req.line}, ${req.network}, ${req.stroops.toString()}::bigint, ${addCount}, ${at}
          FROM agg
          WHERE agg.sum_count + ${addCount} <= ${limits.maxCount}
            AND (${maxStroops}::numeric IS NULL
                 OR agg.sum_stroops + ${req.stroops.toString()}::numeric <= ${maxStroops}::numeric)
          RETURNING id
        `);
      });

      const rows = (result as { rows?: unknown[] }).rows;
      const inserted = Array.isArray(rows) ? rows : Array.isArray(result) ? result : [];
      return inserted.length > 0 ? { ok: true } : { ok: false, reason: "budget_exceeded" };
    },
  };
}
