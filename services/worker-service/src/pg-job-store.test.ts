import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { createPgJobStore } from "./pg-job-store";
import type { VerificationRecordInternal } from "@vellar/verification-service/server";

// Integration tests against a real Postgres (M7 reaper + queue controls). The
// atomic reclaim/dead-letter SQL can only be verified against a real DB.
const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)("createPgJobStore — reaper + queue controls (M7)", () => {
  let pool: pg.Pool;
  let db: NodePgDatabase;

  const record = (id: string, contractId: string): VerificationRecordInternal => ({
    id,
    contractId,
    sourceType: "repo",
    repoUrl: "https://github.com/x/y",
    commitHash: "abc1234",
    toolchainVersion: "1.94.0",
    status: "submitted",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  async function seed(
    id: string,
    contractId: string,
    status = "submitted",
    updatedAt = new Date(),
  ) {
    await db.execute(sql`
      INSERT INTO verification_records (id, contract_id, status, created_at, updated_at, record)
      VALUES (${id}, ${contractId}, ${status}, now(), ${updatedAt}, ${JSON.stringify(record(id, contractId))}::jsonb)
    `);
  }
  async function statusOf(id: string): Promise<string> {
    const r = await db.execute(sql`SELECT status FROM verification_records WHERE id = ${id}`);
    const rows = (r as unknown as { rows: { status: string }[] }).rows;
    return rows[0]?.status ?? "MISSING";
  }
  async function attemptsOf(id: string): Promise<number> {
    const r = await db.execute(
      sql`SELECT coalesce((record->>'attempts')::int, 0) AS a FROM verification_records WHERE id = ${id}`,
    );
    const rows = (r as unknown as { rows: { a: number }[] }).rows;
    return rows[0]?.a ?? 0;
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS verification_records (
        id text PRIMARY KEY,
        contract_id text NOT NULL,
        status text NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        record jsonb NOT NULL
      )
    `);
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE verification_records`);
  });

  it("claim bumps the attempts counter in jsonb", async () => {
    const store = createPgJobStore(db);
    await seed("r1", "C1");
    expect(await attemptsOf("r1")).toBe(0);
    await store.claimSubmitted(1);
    expect(await attemptsOf("r1")).toBe(1);
    expect(await statusOf("r1")).toBe("building");
  });

  it("reaps a stranded 'building' row back to 'submitted' past the timeout", async () => {
    const store = createPgJobStore(db);
    // A building row whose updated_at is 20 min ago (past a 15-min timeout).
    await seed("r1", "C1", "building", new Date(Date.now() - 20 * 60_000));
    const res = await store.reapStranded({ timeoutMs: 15 * 60_000, maxAttempts: 3 });
    expect(res.reclaimed).toBe(1);
    expect(res.deadLettered).toBe(0);
    expect(await statusOf("r1")).toBe("submitted");
  });

  it("does not reap a 'building' row still within the timeout", async () => {
    const store = createPgJobStore(db);
    await seed("r1", "C1", "building", new Date(Date.now() - 5 * 60_000));
    const res = await store.reapStranded({ timeoutMs: 15 * 60_000, maxAttempts: 3 });
    expect(res.reclaimed).toBe(0);
    expect(await statusOf("r1")).toBe("building");
  });

  it("dead-letters a row that has already used all its attempts", async () => {
    const store = createPgJobStore(db);
    await seed("r1", "C1", "building", new Date(Date.now() - 20 * 60_000));
    // Set attempts=3 in the jsonb to simulate a job stranded for the 3rd time.
    await db.execute(
      sql`UPDATE verification_records SET record = jsonb_set(record, '{attempts}', '3') WHERE id = 'r1'`,
    );
    const res = await store.reapStranded({ timeoutMs: 15 * 60_000, maxAttempts: 3 });
    expect(res.deadLettered).toBe(1);
    expect(res.reclaimed).toBe(0);
    expect(await statusOf("r1")).toBe("dead_letter");
    // Dead-lettered rows are never claimed again.
    expect(await store.claimSubmitted(10)).toHaveLength(0);
  });

  it("countActive counts submitted+building only", async () => {
    const store = createPgJobStore(db);
    await seed("r1", "C1", "submitted");
    await seed("r2", "C2", "building");
    await seed("r3", "C3", "verified");
    await seed("r4", "C4", "dead_letter");
    expect(await store.countActive()).toBe(2);
  });

  it("hasActiveForContract is true for submitted/building, false when only terminal", async () => {
    const store = createPgJobStore(db);
    await seed("r1", "C1", "building");
    await seed("r2", "C2", "verified");
    expect(await store.hasActiveForContract("C1")).toBe(true);
    expect(await store.hasActiveForContract("C2")).toBe(false);
    expect(await store.hasActiveForContract("C3")).toBe(false);
  });
});
