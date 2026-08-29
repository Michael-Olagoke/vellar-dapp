import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import {
  registerHealth,
  registerMetrics,
  type SpendBudget,
  type BudgetNetwork,
} from "@vellar/service-kit";
import type { PolicyDefinition } from "@vellar/types";
import { PolicyDeployError, type PolicyDeployer } from "./deploy";
import { generatePolicy, templates, type GeneratedPolicy } from "./templates";
import {
  AttachMismatchError,
  AttachUnconfirmedError,
  type TxLookup,
} from "./verify-attach";
import {
  generateBodySchema,
  deployBodySchema,
  deployInstanceBodySchema,
  validateDefinition,
  validatePolicyForDeployment,
  validatePolicyInstance,
} from "./validation";
import {
  deployPolicyInstance,
  verifyAndRecordAttach,
  simulatePolicyDeploy,
  DEPLOY_FEE,
  type DeploymentDeps,
} from "./deployment";

// Policy API (idea.md §11): validate → generate → (review) → deploy.
// Generated policies persist for review/deploy (idea.md §9 policies table —
// in-memory behind an interface for now, Postgres follows the wallet-service
// pattern before the V1 gate).

export interface PolicyRecord extends GeneratedPolicy {
  id: string;
  createdAt: string;
  status: "generated" | "instance_deployed" | "deployed";
  /** The policy contract instance deployed for this policy (spending limits).
   * Set by /deploy-instance before the wallet attaches it. `wallet` is the
   * smart-account it is bound to — needed to verify the attach tx (L1). */
  instance?: { contractId: string; wallet: string; txHash: string; deployedAt: string };
  /** The completed attach (kit.addPolicy), recorded after the passkey signs. */
  deployment?: { contractId?: string; txHash: string; deployedAt: string };
}

export interface PolicyRepository {
  insert(record: PolicyRecord): Promise<void>;
  find(id: string): Promise<PolicyRecord | undefined>;
  update(record: PolicyRecord): Promise<void>;
}

export function createMemoryPolicyRepository(): PolicyRepository {
  const records = new Map<string, PolicyRecord>();
  return {
    async insert(record) {
      records.set(record.id, record);
    },
    async find(id) {
      return records.get(id);
    },
    async update(record) {
      records.set(record.id, record);
    },
  };
}



export interface PolicyServiceDeps {
  policies?: PolicyRepository;
  now?: () => Date;
  /** Deploys per-user policy contract instances server-side (sponsor-funded).
   * undefined = /deploy-instance returns 503 (no sponsor configured). */
  deployer?: PolicyDeployer;
  /** Readiness probe for DB-aware /health (FIX 7). */
  isReady?: () => boolean | Promise<boolean>;
  /** Rolling-window spend budget for the "deploy" line (FIX 3). Consumed before
   * a sponsor-funded deploy; a refusal returns 503. Unset = disabled. */
  budget?: SpendBudget;
  /** Network label for budget accounting — from server config, never a request
   * body (V5). Required when budget is set. */
  budgetNetwork?: BudgetNetwork;
  /** RPC tx lookup for L1 attach verification, bound to the server-config
   * network's RPC. When set, /policies/deploy verifies the attach tx before
   * stamping 'deployed'. Unset = verification disabled (dev/no-rpc). */
  verifyAttach?: TxLookup;
  /** Network label for the attach verification (server config, never the
   * request body — V5). Defaults to "testnet". */
  network?: BudgetNetwork;
  /** Passphrase used to decode the attach tx envelope. Defaults to testnet. */
  networkPassphrase?: string;
}

export function buildServer(deps: PolicyServiceDeps = {}): FastifyInstance {
  const policies = deps.policies ?? createMemoryPolicyRepository();
  const now = deps.now ?? (() => new Date());

  const app = Fastify({ logger: true });
  registerHealth(app, "policy-service", { isReady: deps.isReady });
  registerMetrics(app, "policy-service");

  const deploymentDeps: DeploymentDeps = {
    policies,
    deployer: deps.deployer,
    verifyAttach: deps.verifyAttach,
    budget: deps.budget,
    budgetNetwork: deps.budgetNetwork,
    network: deps.network,
    networkPassphrase: deps.networkPassphrase,
    now,
  };

  app.get("/policies/templates", async () =>
    templates.map(({ type, title, description, enforcement }) => ({
      type,
      title,
      description,
      enforcement,
    })),
  );

  app.post("/policies/validate", async (request, reply) => {
    return reply.send(validateDefinition(request.body));
  });

  app.post("/policies/generate", async (request, reply) => {
    const parsed = generateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.issues });
    }
    const validation = validateDefinition(parsed.data.definition);
    if (!validation.valid) {
      return reply.code(422).send({ error: "invalid_policy", errors: validation.errors });
    }

    const generated = generatePolicy(
      parsed.data.definition as PolicyDefinition,
      parsed.data.network,
    );
    const record: PolicyRecord = {
      id: randomUUID(),
      createdAt: now().toISOString(),
      status: "generated",
      ...generated,
    };
    await policies.insert(record);
    return reply.code(201).send({ policy: record });
  });

  // Dry-run the instance deploy (build + simulate, no submit) so the UI can
  // confirm the deploy will succeed and show the resource cost before the user
  // commits. Same constructor args the real deploy will use.
  app.post("/policies/:id/simulate", async (request, reply) => {
    if (!deps.deployer) {
      return reply.code(503).send({ error: "deploy_unavailable", reason: "no sponsor configured" });
    }
    const { id } = request.params as { id: string };
    const parsed = deployInstanceBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.issues });
    }
    const record = await policies.find(id);
    if (!record) return reply.code(404).send({ error: "policy_not_found" });

    const deployCheck = validatePolicyForDeployment(record);
    if (!deployCheck.valid) {
      return reply.code(422).send({
        error: "not_deployable",
        reason: deployCheck.error,
      });
    }

    try {
      const result = await simulatePolicyDeploy(deploymentDeps, record, parsed.data.wallet);
      return reply.send(result);
    } catch (err) {
      request.log.error(err, "simulate failed");
      return reply.code(500).send({ error: "simulate_failed" });
    }
  });

  // Deploys the per-user policy contract instance server-side (sponsor-funded),
  // bound to the caller's smart-account. This is step 1 of the two-step attach:
  // the returned contractId is then attached by the wallet via a passkey-signed
  // kit.addPolicy (step 2), which the client records via POST /policies/deploy.
  // No keys touch the wallet here — the instance is inert until attached.
  app.post("/policies/:id/deploy-instance", async (request, reply) => {
    if (!deps.deployer) {
      return reply.code(503).send({ error: "deploy_unavailable", reason: "no sponsor configured" });
    }
    const { id } = request.params as { id: string };
    const parsed = deployInstanceBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.issues });
    }

    const record = await policies.find(id);
    if (!record) return reply.code(404).send({ error: "policy_not_found" });

    // Idempotent-ish: an instance already exists for this policy. Return it
    // rather than spending another deploy.
    if (record.instance) {
      return reply.send({ policy: record, contractId: record.instance.contractId });
    }

    const deployCheck = validatePolicyForDeployment(record);
    if (!deployCheck.valid) {
      return reply.code(422).send({
        error: "not_deployable",
        reason: deployCheck.error,
      });
    }

    try {
      const { record: updated, contractId } = await deployPolicyInstance(
        deploymentDeps,
        record,
        parsed.data.wallet,
      );
      return reply.send({ policy: updated, contractId });
    } catch (err) {
      if (err instanceof PolicyDeployError) {
        request.log.error({ err, policyId: id }, "policy instance deploy failed");
        return reply.code(502).send({ error: "deploy_failed", code: err.code });
      }
      if (err instanceof Error && err.message === "deploy_budget_exceeded") {
        request.log.error({ policyId: id }, "deploy budget exceeded");
        return reply.code(503).send({
          error: "deploy_budget_exceeded",
          message: "Policy-deploy budget reached; try again later.",
        });
      }
      // Budget accounting error or other unexpected error
      request.log.error(err, "deploy-instance failed");
      return reply.code(503).send({ error: "deploy_failed" });
    }
  });

  // Records a completed attach (kit.addPolicy is built and passkey-signed
  // client-side — the service never holds keys).
  app.post("/policies/deploy", async (request, reply) => {
    const parsed = deployBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.issues });
    }
    const record = await policies.find(parsed.data.policyId);
    if (!record) return reply.code(404).send({ error: "policy_not_found" });

    // Full attach verification (L1): the client-supplied txHash must actually be
    // an add_signer on THIS wallet binding THIS policy contract on-chain — not
    // merely a successful hash on the network (that is a public list). Requires
    // a deployed instance carrying the wallet + policy contract to verify against.
    if (deps.verifyAttach) {
      const instanceCheck = validatePolicyInstance(record);
      if (!instanceCheck.valid) {
        return reply.code(422).send({
          error: "no_instance",
          message: instanceCheck.error,
        });
      }
    }

    try {
      const updated = await verifyAndRecordAttach(
        deploymentDeps,
        record,
        parsed.data.txHash,
        parsed.data.contractId,
      );
      return reply.send({ policy: updated });
    } catch (err) {
      if (err instanceof AttachUnconfirmedError) {
        // Chain unreachable / tx not found — do NOT stamp; retryable.
        request.log.warn({ code: err.code, policyId: record.id }, "attach unconfirmed");
        return reply.code(503).send({ error: err.code, message: err.message });
      }
      if (err instanceof AttachMismatchError) {
        // Chain confirmed a mismatch — a lie, not a transient.
        request.log.warn({ code: err.code, policyId: record.id }, "attach mismatch");
        return reply.code(422).send({ error: err.code, message: err.message });
      }
      if (err instanceof Error && err.message === "no_instance") {
        return reply.code(422).send({
          error: "no_instance",
          message: "No deployed policy instance to verify an attach against.",
        });
      }
      throw err;
    }
  });

  app.get("/policies/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const record = await policies.find(id);
    if (!record) return reply.code(404).send({ error: "policy_not_found" });
    return reply.send({ policy: record });
  });

  return app;
}
