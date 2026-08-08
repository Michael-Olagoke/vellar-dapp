import { describe, expect, it } from "vitest";
import { resolvePersistencePolicy } from "./persistence";

describe("resolvePersistencePolicy (M6/FIX 7 fail-closed boot; RA-4 inversion)", () => {
  // RA-4: the default is now FAIL-CLOSED. In-memory is the LESS-safe branch, so
  // it requires an EXPLICIT signal — either ALLOW_INMEMORY=1 (operator opt-in)
  // or an explicitly non-production NODE_ENV (development/test). An UNSET signal
  // — the actual deploy-target state — must fail closed, not degrade.

  it("NODE_ENV UNSET without DATABASE_URL: refuses to boot (the deploy-target reality)", () => {
    // This is the RA-4 defect: on Render/Railway NODE_ENV is unset, so the old
    // isProduction===false silently degraded. It must now fail closed.
    const r = resolvePersistencePolicy({ databaseUrl: undefined, nodeEnv: undefined });
    expect(r.action).toBe("fail");
    if (r.action === "fail") expect(r.reason).toMatch(/DATABASE_URL/);
  });

  it("NODE_ENV UNSET with DATABASE_URL unreachable: refuses to boot (no silent degrade)", () => {
    const r = resolvePersistencePolicy({
      databaseUrl: "postgres://x",
      nodeEnv: undefined,
      connected: false,
    });
    expect(r.action).toBe("fail");
    if (r.action === "fail") expect(r.reason).toMatch(/unreachable|could not connect/i);
  });

  it("dev (NODE_ENV=development) without DATABASE_URL: allows in-memory (explicit dev signal)", () => {
    const r = resolvePersistencePolicy({ databaseUrl: undefined, nodeEnv: "development" });
    expect(r).toEqual({ action: "allow-inmemory" });
  });

  it("test (NODE_ENV=test, e.g. Vitest) without DATABASE_URL: allows in-memory", () => {
    const r = resolvePersistencePolicy({ databaseUrl: undefined, nodeEnv: "test" });
    expect(r).toEqual({ action: "allow-inmemory" });
  });

  it("production without DATABASE_URL: refuses to boot (no silent stateless prod)", () => {
    const r = resolvePersistencePolicy({ databaseUrl: undefined, nodeEnv: "production" });
    expect(r.action).toBe("fail");
    if (r.action === "fail") expect(r.reason).toMatch(/DATABASE_URL/);
  });

  it("production WITH DATABASE_URL but unreachable: refuses to boot (fail-closed, not degrade)", () => {
    const r = resolvePersistencePolicy({
      databaseUrl: "postgres://x",
      nodeEnv: "production",
      connected: false,
    });
    expect(r.action).toBe("fail");
    if (r.action === "fail") expect(r.reason).toMatch(/unreachable|could not connect/i);
  });

  it("WITH DATABASE_URL and connected: proceeds on Postgres (any env)", () => {
    expect(
      resolvePersistencePolicy({
        databaseUrl: "postgres://x",
        nodeEnv: "production",
        connected: true,
      }),
    ).toEqual({ action: "use-postgres" });
    expect(
      resolvePersistencePolicy({
        databaseUrl: "postgres://x",
        nodeEnv: undefined,
        connected: true,
      }),
    ).toEqual({ action: "use-postgres" });
  });

  it("ALLOW_INMEMORY=1 overrides the guard in ANY env (explicit operator opt-in)", () => {
    expect(
      resolvePersistencePolicy({
        databaseUrl: undefined,
        nodeEnv: "production",
        allowInmemory: true,
      }),
    ).toEqual({ action: "allow-inmemory" });
    // Even with NODE_ENV unset, the explicit opt-in is honored.
    expect(
      resolvePersistencePolicy({ databaseUrl: undefined, nodeEnv: undefined, allowInmemory: true }),
    ).toEqual({ action: "allow-inmemory" });
  });

  it("dev WITH DATABASE_URL unreachable: degrades to in-memory (unchanged dev DX)", () => {
    const r = resolvePersistencePolicy({
      databaseUrl: "postgres://x",
      nodeEnv: "development",
      connected: false,
    });
    expect(r).toEqual({ action: "allow-inmemory" });
  });
});
