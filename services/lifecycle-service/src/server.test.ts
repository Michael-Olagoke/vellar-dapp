import { describe, it, expect, beforeEach } from "vitest";
import { buildServer } from "./server";
import type { AccountReader } from "./horizon";
import type { AuditLog, AuditEvent } from "./audit";
import { createMemoryAuditLog } from "./audit";
import { generateRedactionSalt } from "./audit-redaction";

// Test helper: HorizonAccount mock
function mockAccount(overrides: Partial<any> = {}) {
  return {
    accountId: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    sequence: "12345",
    balances: [
      {
        assetType: "native",
        balance: "1000.5",
      },
    ],
    dataKeys: [],
    offers: [],
    openOffers: 0,
    ...overrides,
  };
}

describe("lifecycle-service audit logging", () => {
  let mockReader: AccountReader;
  let auditLog: AuditLog;

  beforeEach(() => {
    const salt = generateRedactionSalt();
    auditLog = createMemoryAuditLog(salt);
    mockReader = {
      async getAccount(accountId: string) {
        if (accountId === "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX") {
          return mockAccount();
        }
        return undefined;
      },
    };
  });

  describe("POST /lifecycle/inspect", () => {
    it("logs lifecycle.account_inspected on successful inspection", async () => {
      const app = buildServer({ reader: mockReader, auditLog });
      const response = await app.inject({
        method: "POST",
        url: "/lifecycle/inspect",
        payload: {
          accountId: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        },
      });

      expect(response.statusCode).toBe(200);

      const events = await auditLog.list();
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "lifecycle.account_inspected",
        }),
      );
    });

    it("does not log raw accountId in audit event", async () => {
      const app = buildServer({ reader: mockReader, auditLog });
      await app.inject({
        method: "POST",
        url: "/lifecycle/inspect",
        payload: {
          accountId: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        },
      });

      const events = await auditLog.list();
      const inspectEvent = events.find((e) => e.type === "lifecycle.account_inspected");
      expect(inspectEvent).toBeDefined();

      // Account object should not be in redacted event
      expect(inspectEvent?.data.account).toBeUndefined();

      // No raw PII should appear in stringified event
      const eventStr = JSON.stringify(inspectEvent);
      expect(eventStr).not.toContain("GXXX");
    });

    it("logs lifecycle.inspect_rejected on invalid accountId format", async () => {
      const app = buildServer({ reader: mockReader, auditLog });
      const response = await app.inject({
        method: "POST",
        url: "/lifecycle/inspect",
        payload: {
          accountId: "INVALID_ACCOUNT", // Not a classic account
        },
      });

      expect(response.statusCode).toBe(400);

      const events = await auditLog.list();
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "lifecycle.inspect_rejected",
          data: expect.objectContaining({
            reason: "not_classic_account",
          }),
        }),
      );
    });

    it("logs lifecycle.inspect_failed on account not found", async () => {
      const app = buildServer({ reader: mockReader, auditLog });
      const response = await app.inject({
        method: "POST",
        url: "/lifecycle/inspect",
        payload: {
          accountId: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY", // Different account
        },
      });

      expect(response.statusCode).toBe(404);

      const events = await auditLog.list();
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "lifecycle.inspect_failed",
          data: expect.objectContaining({
            reason: "account_not_found",
          }),
        }),
      );
    });
  });

  describe("POST /lifecycle/plan", () => {
    it("logs lifecycle.cleanup_planned on successful plan", async () => {
      const app = buildServer({ reader: mockReader, auditLog });
      const response = await app.inject({
        method: "POST",
        url: "/lifecycle/plan",
        payload: {
          accountId: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          destination: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
        },
      });

      expect(response.statusCode).toBe(200);

      const events = await auditLog.list();
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "lifecycle.cleanup_planned",
        }),
      );
    });

    it("hashes accountId and destination in audit log", async () => {
      const app = buildServer({ reader: mockReader, auditLog });
      await app.inject({
        method: "POST",
        url: "/lifecycle/plan",
        payload: {
          accountId: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          destination: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
        },
      });

      const events = await auditLog.list();
      const planEvent = events.find((e) => e.type === "lifecycle.cleanup_planned");
      expect(planEvent).toBeDefined();

      const plan = planEvent?.data.plan as Record<string, unknown>;
      expect(plan).toBeDefined();
      expect(plan.accountRef).toBeDefined();
      expect(plan.destinationRef).toBeDefined();

      // Should be hashes (12 hex chars), not raw account IDs
      expect(typeof plan.accountRef).toBe("string");
      expect((plan.accountRef as string)).toMatch(/^[0-9a-f]{12}$/);
      expect(typeof plan.destinationRef).toBe("string");
      expect((plan.destinationRef as string)).toMatch(/^[0-9a-f]{12}$/);

      // Raw account IDs should NOT appear
      const eventStr = JSON.stringify(planEvent);
      expect(eventStr).not.toContain("GXXX");
      expect(eventStr).not.toContain("GYYYY");
    });

    it("preserves operational fields in audit log", async () => {
      const app = buildServer({
        reader: {
          async getAccount(accountId) {
            return mockAccount({
              balances: [
                { assetType: "native", balance: "1000" },
                { assetType: "credit_alphanum4", assetCode: "USDC", assetIssuer: "G...", balance: "100" },
              ],
              offers: [
                {
                  id: "123",
                  sellingAssetType: "native",
                  buyingAssetType: "credit_alphanum4",
                  buyingAssetCode: "USDC",
                  price: "2.5",
                },
              ],
            });
          },
        },
        auditLog,
      });

      await app.inject({
        method: "POST",
        url: "/lifecycle/plan",
        payload: {
          accountId: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          destination: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
        },
      });

      const events = await auditLog.list();
      const planEvent = events.find((e) => e.type === "lifecycle.cleanup_planned");
      const plan = planEvent?.data.plan as Record<string, unknown>;

      // Operational fields preserved
      expect(plan.estimatedTransactions).toBeDefined();
      expect(typeof plan.estimatedTransactions).toBe("number");
      expect(plan.mergeReady).toBeDefined();
      expect(typeof plan.mergeReady).toBe("boolean");

      // Blocker types preserved (not descriptions)
      expect(plan.blockerTypes).toBeDefined();
      expect(Array.isArray(plan.blockerTypes)).toBe(true);

      // No sensitive descriptions
      const eventStr = JSON.stringify(planEvent);
      expect(eventStr).not.toContain("USDC");
      expect(eventStr).not.toContain("100");
    });

    it("logs lifecycle.plan_rejected on invalid accountId", async () => {
      const app = buildServer({ reader: mockReader, auditLog });
      const response = await app.inject({
        method: "POST",
        url: "/lifecycle/plan",
        payload: {
          accountId: "INVALID_ACCOUNT",
          destination: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
        },
      });

      expect(response.statusCode).toBe(400);

      const events = await auditLog.list();
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "lifecycle.plan_rejected",
          data: expect.objectContaining({
            reason: "not_classic_account",
          }),
        }),
      );
    });

    it("logs lifecycle.plan_rejected on same accountId and destination", async () => {
      const app = buildServer({ reader: mockReader, auditLog });
      const sameAccount = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
      const response = await app.inject({
        method: "POST",
        url: "/lifecycle/plan",
        payload: {
          accountId: sameAccount,
          destination: sameAccount,
        },
      });

      expect(response.statusCode).toBe(400);

      const events = await auditLog.list();
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "lifecycle.plan_rejected",
          data: expect.objectContaining({
            reason: "invalid_destination",
          }),
        }),
      );
    });
  });

  describe("POST /lifecycle/execute", () => {
    it("logs lifecycle.cleanup_executed with redacted steps and plan", async () => {
      const app = buildServer({ reader: mockReader, auditLog });
      const response = await app.inject({
        method: "POST",
        url: "/lifecycle/execute",
        payload: {
          accountId: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          destination: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
        },
      });

      expect(response.statusCode).toBe(200);

      const events = await auditLog.list();
      const executeEvent = events.find((e) => e.type === "lifecycle.cleanup_executed");
      expect(executeEvent).toBeDefined();

      // Should have steps and plan
      expect((executeEvent?.data as Record<string, unknown>).steps).toBeDefined();
      expect((executeEvent?.data as Record<string, unknown>).plan).toBeDefined();
    });

    it("does not log transaction XDR in audit event", async () => {
      const app = buildServer({ reader: mockReader, auditLog });
      await app.inject({
        method: "POST",
        url: "/lifecycle/execute",
        payload: {
          accountId: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          destination: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
        },
      });

      const events = await auditLog.list();
      const executeEvent = events.find((e) => e.type === "lifecycle.cleanup_executed");
      const eventStr = JSON.stringify(executeEvent);

      // XDR should not be present
      expect(eventStr).not.toContain("xdr");
    });

    it("preserves transaction hash for tracking", async () => {
      const app = buildServer({ reader: mockReader, auditLog });
      await app.inject({
        method: "POST",
        url: "/lifecycle/execute",
        payload: {
          accountId: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          destination: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
        },
      });

      const events = await auditLog.list();
      const executeEvent = events.find((e) => e.type === "lifecycle.cleanup_executed");
      const steps = (executeEvent?.data as Record<string, unknown>).steps as Record<string, unknown>[];

      // Steps should have hashes but not XDR
      expect(steps.length).toBeGreaterThan(0);
      for (const step of steps) {
        expect(step.hash).toBeDefined();
        expect(typeof step.hash).toBe("string");
        expect((step.hash as string).length).toBeGreaterThan(0);
        expect(step.xdr).toBeUndefined();
      }
    });
  });

  describe("POST /lifecycle/merge", () => {
    it("logs lifecycle.account_merged on successful merge", async () => {
      const app = buildServer({ reader: mockReader, auditLog });
      const response = await app.inject({
        method: "POST",
        url: "/lifecycle/merge",
        payload: {
          accountId: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          destination: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
        },
      });

      expect(response.statusCode).toBe(200);

      const events = await auditLog.list();
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "lifecycle.account_merged",
        }),
      );
    });

    it("does not log account IDs or XDR in merge event", async () => {
      const app = buildServer({ reader: mockReader, auditLog });
      await app.inject({
        method: "POST",
        url: "/lifecycle/merge",
        payload: {
          accountId: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          destination: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
        },
      });

      const events = await auditLog.list();
      const mergeEvent = events.find((e) => e.type === "lifecycle.account_merged");
      const eventStr = JSON.stringify(mergeEvent);

      // No raw account IDs
      expect(eventStr).not.toContain("GXXX");
      expect(eventStr).not.toContain("GYYYY");

      // No XDR
      expect(eventStr).not.toContain("xdr");
    });

    it("logs lifecycle.merge_rejected when blockers remain", async () => {
      const appWithBlockers = buildServer({
        reader: {
          async getAccount(accountId) {
            return mockAccount({
              balances: [
                { assetType: "native", balance: "1000" },
                { assetType: "credit_alphanum4", assetCode: "USDC", assetIssuer: "G...", balance: "100" },
              ],
            });
          },
        },
        auditLog,
      });

      const response = await appWithBlockers.inject({
        method: "POST",
        url: "/lifecycle/merge",
        payload: {
          accountId: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          destination: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
        },
      });

      expect(response.statusCode).toBe(409);

      const events = await auditLog.list();
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "lifecycle.merge_rejected",
          data: expect.objectContaining({
            reason: "not_merge_ready",
          }),
        }),
      );
    });
  });

  describe("No PII Leakage Regression", () => {
    it("no endpoint logs raw account IDs in audit trail", async () => {
      const accountId = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
      const destination = "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY";

      const app = buildServer({ reader: mockReader, auditLog });

      // Call all endpoints
      await app.inject({
        method: "POST",
        url: "/lifecycle/inspect",
        payload: { accountId },
      });

      await app.inject({
        method: "POST",
        url: "/lifecycle/plan",
        payload: { accountId, destination },
      });

      await app.inject({
        method: "POST",
        url: "/lifecycle/execute",
        payload: { accountId, destination },
      });

      await app.inject({
        method: "POST",
        url: "/lifecycle/merge",
        payload: { accountId, destination },
      });

      // Check all audit events
      const events = await auditLog.list();
      const allEventsStr = JSON.stringify(events);

      // No raw account IDs should appear
      expect(allEventsStr).not.toContain(accountId.substring(0, 10));
      expect(allEventsStr).not.toContain(destination.substring(0, 10));
    });

    it("no endpoint logs transaction XDR or sensitive descriptions", async () => {
      const app = buildServer({ reader: mockReader, auditLog });

      await app.inject({
        method: "POST",
        url: "/lifecycle/execute",
        payload: {
          accountId: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          destination: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
        },
      });

      const events = await auditLog.list();
      const allEventsStr = JSON.stringify(events);

      // No XDR
      expect(allEventsStr.toLowerCase()).not.toContain("xdr");
      // No descriptions with balances
      expect(allEventsStr).not.toContain("holds");
    });
  });

  describe("Correlation Across Events", () => {
    it("same account produces same hash across multiple events", async () => {
      const accountId = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
      const destination = "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY";

      const app = buildServer({ reader: mockReader, auditLog });

      await app.inject({
        method: "POST",
        url: "/lifecycle/plan",
        payload: { accountId, destination },
      });

      await app.inject({
        method: "POST",
        url: "/lifecycle/execute",
        payload: { accountId, destination },
      });

      const events = await auditLog.list();
      const planEvent = events.find((e) => e.type === "lifecycle.cleanup_planned");
      const executeEvent = events.find((e) => e.type === "lifecycle.cleanup_executed");

      const planRef = ((planEvent?.data as Record<string, unknown>).plan as Record<string, unknown>)
        .accountRef;
      const executeRef = ((executeEvent?.data as Record<string, unknown>).plan as Record<string, unknown>)
        .accountRef;

      // Same account should hash to same value
      expect(planRef).toBe(executeRef);
    });
  });
});
