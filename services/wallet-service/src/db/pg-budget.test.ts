import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import { createPgSpendBudget, type PgBudgetConfig } from "@vellar/service-kit";
import { connectDb, type DbHandle } from "./client";

// Integration tests against a real Postgres. Skipped LOCALLY unless
// TEST_DATABASE_URL is set (docker compose up + TEST_DATABASE_URL). The
// serialized check-and-record (RA-2 advisory lock) can only be verified against
// a real DB, not a mock — so "skips locally" must never become "silently skips
// in CI": when CI_REQUIRE_DB=1 (set in the CI workflow) but no DB is
// configured, the suite FAILS instead of skipping, so the guarantee cannot
// vanish by a dropped env var. (This is why RA-2 shipped: the concurrency test
// was effectively decorative — skipped locally, and its Promise.all-over-one-
// pool shape never raced even when it ran.)
const DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!DATABASE_URL && process.env.CI_REQUIRE_DB === "1") {
  throw new Error(
    "CI_REQUIRE_DB=1 but TEST_DATABASE_URL is unset — the pg-budget concurrency " +
      "guarantee (RA-2) would silently skip. Provision Postgres in CI or unset CI_REQUIRE_DB.",
  );
}

describe.skipIf(!DATABASE_URL)("createPgSpendBudget (atomic rolling-window budget)", () => {
  let handle: DbHandle;
  let db: DbHandle["db"];

  const baseConfig: PgBudgetConfig = {
    windowMs: 3_600_000, // 1h
    limits: {
      sponsor: { maxStroops: 500_000_000n, maxCount: 500 }, // 50 XLM / 500
      deploy: { maxStroops: 200_000_000n, maxCount: 20 }, // 20 XLM / 20
      create: { maxCount: 30 }, // count-only
    },
  };

  beforeAll(async () => {
    // Use the real migration path (connectDb runs drizzle migrate) so this
    // suite and pg-repository.test share one migration-tracked schema.
    handle = await connectDb(DATABASE_URL as string);
    db = handle.db;
  });

  afterAll(async () => {
    // Guarded: if beforeAll's connectDb threw, handle never got assigned and a
    // bare close() would bury the real failure under a TypeError.
    await handle?.close();
  });

  async function ledgerRowCount(): Promise<number> {
    const res = await db.execute(sql`SELECT count(*)::int AS n FROM spend_ledger`);
    const rows = (res as unknown as { rows: { n: number }[] }).rows;
    return rows[0]?.n ?? 0;
  }

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE spend_ledger`);
  });

  it("allows spend under the XLM ceiling and records it", async () => {
    const budget = createPgSpendBudget(db, baseConfig);
    const r = await budget.tryConsume({ line: "sponsor", network: "testnet", stroops: 100_000n });
    expect(r.ok).toBe(true);
    expect(await ledgerRowCount()).toBe(1);
  });

  it("refuses once the XLM ceiling is reached (budget_exceeded)", async () => {
    const budget = createPgSpendBudget(db, {
      ...baseConfig,
      limits: { ...baseConfig.limits, sponsor: { maxStroops: 1_000_000n, maxCount: 500 } },
    });
    expect(
      (await budget.tryConsume({ line: "sponsor", network: "testnet", stroops: 1_000_000n })).ok,
    ).toBe(true);
    const over = await budget.tryConsume({ line: "sponsor", network: "testnet", stroops: 1n });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toBe("budget_exceeded");
  });

  it("refuses once the COUNT ceiling is reached even with XLM headroom (create line)", async () => {
    const budget = createPgSpendBudget(db, {
      ...baseConfig,
      limits: { ...baseConfig.limits, create: { maxCount: 2 } },
    });
    expect((await budget.tryConsume({ line: "create", network: "testnet", stroops: 0n })).ok).toBe(
      true,
    );
    expect((await budget.tryConsume({ line: "create", network: "testnet", stroops: 0n })).ok).toBe(
      true,
    );
    expect((await budget.tryConsume({ line: "create", network: "testnet", stroops: 0n })).ok).toBe(
      false,
    );
  });

  it("scopes by (line, network): mainnet budget is separate from testnet", async () => {
    const budget = createPgSpendBudget(db, {
      ...baseConfig,
      limits: { ...baseConfig.limits, sponsor: { maxStroops: 1_000_000n, maxCount: 1 } },
    });
    expect(
      (await budget.tryConsume({ line: "sponsor", network: "testnet", stroops: 1_000_000n })).ok,
    ).toBe(true);
    // testnet is now full, but mainnet still has room.
    expect((await budget.tryConsume({ line: "sponsor", network: "testnet", stroops: 1n })).ok).toBe(
      false,
    );
    expect(
      (await budget.tryConsume({ line: "sponsor", network: "mainnet", stroops: 1_000_000n })).ok,
    ).toBe(true);
  });

  it("ignores rows outside the rolling window", async () => {
    // Insert an old row directly (2h ago) that should not count against a 1h window.
    await db.execute(sql`
      INSERT INTO spend_ledger (id, line, network, stroops, count, at)
      VALUES ('old', 'sponsor', 'testnet', 500000000, 1, now() - interval '2 hours')
    `);
    const budget = createPgSpendBudget(db, baseConfig);
    // 50 XLM ceiling; the old 50-XLM row is outside the window, so this passes.
    expect(
      (await budget.tryConsume({ line: "sponsor", network: "testnet", stroops: 400_000_000n })).ok,
    ).toBe(true);
  });

  it("CONCURRENCY: with room for exactly one more, only one of N truly-parallel consumes succeeds", async () => {
    // RA-2: this MUST use independent connections. Firing Promise.all over a
    // single drizzle pool serializes on the pool and never exercises real
    // concurrency — the decorative shape that let RA-2 ship. Each consumer here
    // gets its OWN single-connection pool, so N tryConsumes truly race. Against
    // the old single-statement version this overshoots (all read the same
    // committed sum); the advisory lock (taken before the read) holds it to 1.
    const N = 12;
    const pools: pg.Pool[] = [];
    const budgets = Array.from({ length: N }, () => {
      const pool = new pg.Pool({ connectionString: DATABASE_URL as string, max: 1 });
      pools.push(pool);
      return createPgSpendBudget(drizzle(pool), {
        ...baseConfig,
        limits: { ...baseConfig.limits, sponsor: { maxStroops: 500_000_000n, maxCount: 1 } },
      });
    });
    try {
      const results = await Promise.all(
        budgets.map((b) => b.tryConsume({ line: "sponsor", network: "testnet", stroops: 1_000n })),
      );
      const okCount = results.filter((r) => r.ok).length;
      expect(okCount).toBe(1);
      expect(await ledgerRowCount()).toBe(1);
    } finally {
      await Promise.all(pools.map((p) => p.end()));
    }
  });

  it("CONCURRENCY: different (line, network) keys do NOT serialize against each other", async () => {
    // The advisory lock is per-key: a sponsor:testnet consume and a
    // deploy:mainnet consume race freely and both land at their own ceilings.
    const mkBudget = () => {
      const pool = new pg.Pool({ connectionString: DATABASE_URL as string, max: 1 });
      return {
        pool,
        budget: createPgSpendBudget(drizzle(pool), {
          ...baseConfig,
          limits: {
            ...baseConfig.limits,
            sponsor: { maxStroops: 500_000_000n, maxCount: 1 },
            deploy: { maxStroops: 200_000_000n, maxCount: 1 },
          },
        }),
      };
    };
    const a = mkBudget();
    const b = mkBudget();
    try {
      const [r1, r2] = await Promise.all([
        a.budget.tryConsume({ line: "sponsor", network: "testnet", stroops: 1_000n }),
        b.budget.tryConsume({ line: "deploy", network: "mainnet", stroops: 1_000n }),
      ]);
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(await ledgerRowCount()).toBe(2);
    } finally {
      await Promise.all([a.pool.end(), b.pool.end()]);
    }
  });
});
