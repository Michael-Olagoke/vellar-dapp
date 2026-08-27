import { describe, expect, it } from "vitest";
import {
  budgetLimitsFromEnv,
  createUnavailableBudget,
  withinCeiling,
  type BudgetLimits,
} from "./budget";
import { createPgSpendBudget, type BudgetDb } from "./pg-budget";

describe("withinCeiling (pure ceiling logic)", () => {
  const limits: BudgetLimits = { maxStroops: 500_000_000n, maxCount: 500 };

  it("accepts when adding one call stays under both dimensions", () => {
    expect(withinCeiling({ priorStroops: 0n, priorCount: 0 }, 100_000n, limits)).toBe(true);
  });

  it("rejects when the XLM dimension would be exceeded (tighter dimension trips first)", () => {
    expect(withinCeiling({ priorStroops: 500_000_000n, priorCount: 1 }, 1n, limits)).toBe(false);
  });

  it("rejects when the COUNT dimension would be exceeded even if XLM has room", () => {
    expect(withinCeiling({ priorStroops: 0n, priorCount: 500 }, 1n, limits)).toBe(false);
  });

  it("count-only line (maxStroops omitted) ignores the XLM dimension", () => {
    const createLimits: BudgetLimits = { maxCount: 30 };
    expect(withinCeiling({ priorStroops: 0n, priorCount: 29 }, 0n, createLimits)).toBe(true);
    expect(withinCeiling({ priorStroops: 0n, priorCount: 30 }, 0n, createLimits)).toBe(false);
  });

  it("boundary: exactly at the ceiling is allowed, one over is not", () => {
    expect(withinCeiling({ priorStroops: 499_999_999n, priorCount: 0 }, 1n, limits)).toBe(true);
    expect(withinCeiling({ priorStroops: 500_000_000n, priorCount: 0 }, 1n, limits)).toBe(false);
  });
});

describe("createUnavailableBudget (fail-closed stub)", () => {
  it("always refuses — an unaccountable budget must never allow unmetered spend", async () => {
    const budget = createUnavailableBudget();
    const r = await budget.tryConsume({ line: "sponsor", network: "testnet", stroops: 1n });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("budget_unavailable");
  });
});

describe("budgetLimitsFromEnv", () => {
  it("reads XLM (as XLM units → stroops) and count from env with defaults", () => {
    const limits = budgetLimitsFromEnv(
      { maxXlmVar: "BUDGET_SPONSOR_MAX_XLM", maxCountVar: "BUDGET_SPONSOR_MAX_COUNT" },
      { defaultMaxXlm: 50, defaultMaxCount: 500 },
      { BUDGET_SPONSOR_MAX_XLM: "10", BUDGET_SPONSOR_MAX_COUNT: "42" },
    );
    expect(limits).toEqual({ maxStroops: 100_000_000n, maxCount: 42 });
  });

  it("falls back to defaults when env is unset", () => {
    const limits = budgetLimitsFromEnv(
      { maxXlmVar: "BUDGET_SPONSOR_MAX_XLM", maxCountVar: "BUDGET_SPONSOR_MAX_COUNT" },
      { defaultMaxXlm: 50, defaultMaxCount: 500 },
      {},
    );
    expect(limits).toEqual({ maxStroops: 500_000_000n, maxCount: 500 });
  });

  it("count-only line: no maxXlmVar yields a limit with no XLM ceiling", () => {
    const limits = budgetLimitsFromEnv(
      { maxCountVar: "BUDGET_CREATE_MAX_COUNT" },
      { defaultMaxCount: 30 },
      {},
    );
    expect(limits).toEqual({ maxCount: 30 });
  });
});

// RA-2: the check-and-record must be serialized against concurrent same-key
// callers, or N parallel requests each read the same committed sum and all pass
// (ceiling overshoot). The mechanism is pg_advisory_xact_lock inside a
// transaction, taken BEFORE the aggregate read. These unit tests prove the
// ORDER and structure without a real DB; pg-budget.test.ts proves the actual
// concurrency guarantee against Postgres.
describe("createPgSpendBudget serialization (RA-2)", () => {
  /** Flatten a drizzle `sql` object to its literal SQL text (chunk values). */
  function sqlText(q: unknown): string {
    const chunks = (q as { queryChunks?: Array<{ value?: string[] } | null> }).queryChunks ?? [];
    return chunks
      .map((c) => (c && Array.isArray(c.value) ? c.value.join("") : ""))
      .join(" ")
      .toLowerCase();
  }

  /** A mock BudgetDb that records, in order, every statement run inside the
   * transaction, and returns an insert row so the consume reads as ok. */
  function recordingDb() {
    const order: string[] = [];
    const db: BudgetDb = {
      async execute() {
        throw new Error("consume must run inside a transaction, not a bare execute");
      },
      async transaction(fn) {
        const tx = {
          async execute(q: unknown) {
            order.push(sqlText(q));
            // The final check-insert statement RETURNs a row id when it inserts.
            return { rows: [{ id: "row-1" }] };
          },
        };
        return fn(tx as never);
      },
    };
    return { db, order };
  }

  it("takes the advisory lock BEFORE the aggregate read, inside one transaction", async () => {
    const { db, order } = recordingDb();
    const budget = createPgSpendBudget(db, {
      windowMs: 3_600_000,
      limits: {
        sponsor: { maxStroops: 1n, maxCount: 1 },
        deploy: { maxCount: 1 },
        create: { maxCount: 1 },
      },
    });

    await budget.tryConsume({ line: "sponsor", network: "testnet", stroops: 0n });

    // First statement in the tx acquires the per-(line,network) advisory lock…
    expect(order[0]).toContain("pg_advisory_xact_lock");
    // …and only AFTER it do we aggregate the window and insert.
    const lockIdx = order.findIndex((s) => s.includes("pg_advisory_xact_lock"));
    const aggIdx = order.findIndex((s) => s.includes("spend_ledger") && s.includes("sum"));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(aggIdx).toBeGreaterThan(lockIdx);
  });

  it("keys the advisory lock on (line, network) so different keys don't serialize", async () => {
    const { db, order } = recordingDb();
    const budget = createPgSpendBudget(db, {
      windowMs: 3_600_000,
      limits: { sponsor: { maxCount: 1 }, deploy: { maxCount: 1 }, create: { maxCount: 1 } },
    });
    await budget.tryConsume({ line: "deploy", network: "mainnet", stroops: 0n });
    const lockStmt = order.find((s) => s.includes("pg_advisory_xact_lock"))!;
    // The lock argument derives from line+network (hashed), not a constant.
    expect(lockStmt).toContain("hashtext");
  });
});
