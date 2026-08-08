import { describe, expect, it } from "vitest";
import { createMemoryJobStore } from "./memory-job-store";
import type { VerificationJobInput } from "./verify";

const job = (contractId: string): VerificationJobInput => ({
  contractId,
  sourceType: "repo",
  repoUrl: "https://github.com/x/y",
  commitHash: "abc1234",
  toolchainVersion: "1.94.0",
});

describe("memory job store — reaper (M7)", () => {
  it("reclaims a row stuck in 'building' past the timeout, back to 'submitted'", async () => {
    const store = createMemoryJobStore();
    store.submit("r1", job("C1"), 0);
    await store.claimSubmitted(1); // -> building, stamps startedBuildingAtMs
    const started = store.get("r1")!.startedBuildingAtMs!;
    // Not yet timed out.
    let res = await store.reapStranded({
      timeoutMs: 900_000,
      maxAttempts: 3,
      nowMs: started + 899_999,
    });
    expect(res.reclaimed).toBe(0);
    expect(store.get("r1")!.status).toBe("building");
    // Past the timeout -> reclaimed to submitted.
    res = await store.reapStranded({
      timeoutMs: 900_000,
      maxAttempts: 3,
      nowMs: started + 900_001,
    });
    expect(res.reclaimed).toBe(1);
    expect(store.get("r1")!.status).toBe("submitted");
  });

  it("parks a job in 'dead_letter' after maxAttempts instead of looping forever", async () => {
    const store = createMemoryJobStore();
    store.submit("r1", job("C1"), 0);
    // maxAttempts = 3: strand it 3 times; the 3rd strand dead-letters it.
    for (let i = 1; i <= 3; i++) {
      await store.claimSubmitted(1);
      const started = store.get("r1")!.startedBuildingAtMs!;
      const res = await store.reapStranded({
        timeoutMs: 900_000,
        maxAttempts: 3,
        nowMs: started + 900_001,
      });
      if (i < 3) {
        expect(res.reclaimed).toBe(1);
        expect(res.deadLettered).toBe(0);
        expect(store.get("r1")!.status).toBe("submitted");
      } else {
        expect(res.reclaimed).toBe(0);
        expect(res.deadLettered).toBe(1);
        expect(store.get("r1")!.status).toBe("dead_letter");
      }
    }
    // A dead-lettered row is never claimed again.
    expect(await store.claimSubmitted(10)).toHaveLength(0);
  });

  it("does not reap a 'building' row that is still within the timeout", async () => {
    const store = createMemoryJobStore();
    store.submit("r1", job("C1"), 0);
    await store.claimSubmitted(1);
    const started = store.get("r1")!.startedBuildingAtMs!;
    const res = await store.reapStranded({
      timeoutMs: 900_000,
      maxAttempts: 3,
      nowMs: started + 899_999,
    });
    expect(res.reclaimed).toBe(0);
    expect(store.get("r1")!.status).toBe("building");
  });
});

describe("memory job store — queue controls (M7)", () => {
  it("countActive counts submitted + building, not terminal states", async () => {
    const store = createMemoryJobStore();
    store.submit("r1", job("C1"));
    store.submit("r2", job("C2"));
    expect(await store.countActive()).toBe(2);
    await store.claimSubmitted(1); // one -> building, still active
    expect(await store.countActive()).toBe(2);
    await store.complete("r1", { status: "verified", statusDetail: "ok", log: "" });
    await store.complete("r2", { status: "failed", statusDetail: "no", log: "" });
    expect(await store.countActive()).toBe(0);
  });

  it("hasActiveForContract is true while submitted/building, false once terminal", async () => {
    const store = createMemoryJobStore();
    store.submit("r1", job("C1"));
    expect(await store.hasActiveForContract("C1")).toBe(true);
    expect(await store.hasActiveForContract("C2")).toBe(false);
    await store.complete("r1", { status: "verified", statusDetail: "ok", log: "" });
    // A terminal record does NOT block a fresh resubmission of the same contract.
    expect(await store.hasActiveForContract("C1")).toBe(false);
  });
});
