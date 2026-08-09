# Vellar Wallet — Pre-Mainnet Security Audit

> **Context for a fresh clone:** `technical-doc.md`, `BUILD-PLAN.md`, `CLAUDE.md`, and
> `docs/decisions.md` are **gitignored** — they exist only in the author's working tree and
> do **not** travel with the repository. This file and [`docs/architecture-analysis.md`](architecture-analysis.md)
> are therefore the **only** architecture/security context a clone receives. Read both.
>
> **Method:** 10 deep investigators (one per priority hunt), each required to read the
> mitigating code before reporting; every finding then adversarially re-verified against the
> actual code (the verifier defaults to _refuting_). 21 findings surfaced — 16 confirmed at
> severity, 5 downgraded, 0 refuted. Read-only: no code was modified to produce this.
>
> **The headline:** the design claim "no app-layer auth is fine because value transfer is
> gated on-chain" holds for **user-fund theft** but fails for one class of side effect the
> chain never sees: **the sponsor account's own spending.** The sponsor is the fee _payer_,
> not the wallet; `__check_auth` governs the auth entries' effects, but nothing on-chain
> restricts _who may make the sponsor pay_. That is where the Critical lives.

Severities were assigned for the **pre-mainnet posture**: the code path is identical for
testnet and mainnet, and the sponsor/relayer paths arm on secret _presence_ with no network
gate, so a testnet-only finding today becomes a funded-mainnet finding the moment a mainnet
key is configured.

---

## 🔴 CRITICAL

### C1 — Sponsor is an open fee-payer for arbitrary contract calls `[my code]`

`services/wallet-service/src/sponsor.ts:26-39, 41-104`

`needsSponsorRebuild()` validates only four **structural** properties — parseable, exactly one
op, type `invokeHostFunction`, non-empty auth, every auth entry's credential kind !=
source-account. It never inspects `op.func` (target contract / function) or the auth subject.
`createSponsorSubmitter` then discards the caller's fee source, rebuilds the exact
`{func, auth}` with the **sponsor account as fee payer** at a 10,000,000-stroop (1 XLM)
inclusion-fee ceiling, `prepareTransaction` (re-simulates real fee), sponsor-signs, submits.

- **Attack (zero cost, no auth):** build any single-op `invokeHostFunction` against _any_
  Soroban contract (a DEX, a token, the attacker's own contract) whose auth entry uses
  address credentials, POST to `/wallet/submit`. The sponsor pays the fee. The attacker uses
  the sponsor as a free fee-payer for arbitrary on-chain activity.
- **On-chain gate coverage: NONE.** Paying the fee _is_ the side effect; the sponsor is not
  the wallet, so `__check_auth` never sees it and nothing on-chain restricts who uses the
  sponsor as fee payer.
- **Testnet:** free XLM, drains a refillable account — real bug, no loss. **Mainnet:** direct
  unbounded drain of real XLM. Armed purely on `SPONSOR_SECRET_KEY` presence (`index.ts:12`)
  with **no network gate**, despite the "Testnet fee-sponsor" comment (`config.ts:11-12`).
- **Fix (keeps stateless relayer, no app-auth):** in `needsSponsorRebuild`, decode `op.func`
  and reject unless the invoked contract is a Vellar-deployed smart-account the product
  recognizes **and** every address-credential auth subject is that same wallet — make on-chain
  identity the gate. Lower the fee bid from the 1-XLM ceiling to a simulation-derived value.
- **Verify:** POST an `invokeHostFunction` at a non-Vellar contract → rejected, not sponsored;
  a legitimate wallet op still sponsors.

---

## 🟠 HIGH

### H1 — Unauthenticated 1-XLM-per-call financial DoS `[my code]`

`services/wallet-service/src/sponsor.ts:58-60`; `services/policy-service/src/deploy.ts:92,120-122`

Same root as C1, plus a second lever: `/policies/:id/deploy-instance` funds a
`createCustomContract` at `DEPLOY_FEE = 10,000,000` bound to a **caller-supplied wallet
address** (regex-validated only). Per-policyId idempotency exists, but `/policies/generate` is
unmetered so a fresh policyId per deploy defeats it — no total cap.

**The gateway rate limit does not bind:** no `trustProxy` → `req.ip` is the socket peer;
behind Render/Railway ingress it collapses to one shared 120/min bucket (hurts legit users,
does not stop an IP-rotating attacker who gets a fresh 120/min per IP). `X-Forwarded-For`
spoofing to _lower_ the count does **not** work (no keyGenerator, XFF untrusted) — the failure
is the opposite. Deploy-instance is the more expensive lever (deploy cost + rent per call).

- **Fix:** C1's scoping + a per-sponsor rolling-window **spend** budget (not request cap)
  backed by Postgres; require the wallet to exist in the wallet repository before spending a
  deploy; lower both fee bids to simulation-derived values.

### H2 — repoUrl SSRF: git clone runs on the host, outside the sandbox `[my code]`

`services/worker-service/src/executor.ts:163`

`repoUrl` is validated only by `z.string().url()` — empirically confirmed (zod 4.4.3) to
accept `http://169.254.169.254/…`, `http://127.0.0.1:6379/`, `file://`, `git://`, `ssh://`.
The `--network=none` isolation is on the **docker build step only**; `git clone` runs on the
**host** via `spawn` with inherited env — no scheme/host allowlist, no `GIT_ALLOW_PROTOCOL`,
ambient host git/SSH credentials.

- **Gated on `VERIFY_BUILD_IMAGE`** (the real executor) — inert in default stub mode, live on
  any real build box: unauthenticated cloud-metadata / RFC1918 / loopback reach.
- **Held mitigations:** submodules not fetched (`--no-checkout`, no `--recurse-submodules`);
  dash-prefix option injection blocked by the URL-scheme requirement; commitHash regex-bounded.
- **Fix:** allowlist `https://` to public hosts only; resolve DNS and re-check against
  RFC1918/link-local (defeat rebinding); pass repoUrl after `--`; `protocol.allow=never` for
  non-https; run the clone itself inside network isolation with no ambient credentials.

> **Status (FIX 6): CLOSED.** Implemented in `services/worker-service/src/repo-url-guard.ts` +
> `executor.ts`. The guard requires public `https`, rejects userinfo, resolves the host once,
> and refuses any answer in a private/loopback/link-local range (incl. `169.254.169.254`,
> RFC1918, IPv6 loopback/link-local, IPv4-mapped). It **returns the validated IP**, which the
> executor pins into git's connection so the check and the connection agree **by construction,
> not by timing**:
>
> - **Connection pinned:** `-c http.curloptResolve=<host>:443:<ip>` (libcurl `CURLOPT_RESOLVE`)
>   forces git to connect to the exact address the guard validated — git does **not** re-resolve
>   the hostname. This substitutes the address only; **TLS SNI + certificate validation still use
>   the hostname**, so the pin does not open a MITM window (verified against git 2.50.1's
>   `http.curloptResolve` semantics).
> - **Redirects forbidden:** `-c http.followRedirects=false` turns any 30x into an error, so the
>   remote cannot bounce git to a different, unpinned host that it would resolve freely. (This is
>   chosen over re-running the guard per redirect target — an error is simpler and strictly
>   safer for a verification clone, which never legitimately needs a cross-host redirect.)
> - Plus `protocol.allow=never` + `protocol.https.allow=always` and `repoUrl` after `--`.
>
> A test asserts a host whose DNS flips public→private between the guard's resolution and the
> clone connects to the pinned **public** IP (or fails), never the private one. The rebinding
> TOCTOU window is therefore closed.
>
> **Stronger alternative (for later):** when the worker gets its own dedicated host, run the
> clone inside a network namespace that can only reach public routes — that removes reliance on
> the git/libcurl pin entirely and also covers any non-HTTP fetch path. Not required now; the
> pin + redirect-block fully closes the HTTPS clone path this executor uses.

### H3 — Blind SSRF upgraded to a read primitive via the public build log `[my code]`

`services/worker-service/src/executor.ts:164`

Clone stdout+stderr is captured into the record's `log`, and `toPublic`
(`verification-service/src/server.ts:229-232`) strips only `sourceArchiveRef`/`lockfileHash` —
`log` is returned by the unauthenticated `GET /verification/:contractId`. git's error output
(redirect targets, resolved host/IP, TLS/`fatal:` server echoes) turns H2's blind SSRF into a
read oracle. Same build-box gating as H2.

- **Fix:** keep a private detailed log; return only a sanitized public status string. Retain
  even after H2 is fixed (defense in depth).

---

## 🟡 MEDIUM

- **M1 — Session enumeration + revocation `[my code]`** — `wallet-service/src/server.ts:163-183`.
  `GET /wallet/sessions?contractId=` lists every session for any _public_ contractId;
  `DELETE /wallet/session/:id` revokes any by id — no ownership check. **Verified sessions are
  NOT access tokens** (only consumer is a cosmetic "this device" label + self-disconnect;
  web `connected` state derives from the SDK localStorage store, not the server row), so this
  is device-management DoS + session-graph disclosure, not an authz bypass. **Fix:** authorize
  session read/revoke with the caller's own opaque session id as a bearer capability; stop
  letting a bare public contractId enumerate ids.

  > **Status (M1/RA-3): CLOSED.** The session routes are now gated on a bearer session capability
  > (`Authorization: Bearer <sessionId>`), and — importantly — **the premise this finding was rated
  > on has changed:** a session id is no longer "not an access token." It is now a **narrow bearer
  > capability** for the session routes (list / read / revoke), scoped to the account it is bound to,
  > with a 7-day sliding expiry (matching the device signer; expired == absent). It authorizes ONLY
  > those routes — a non-drift test asserts a valid session id grants nothing on `/wallet/submit` or
  > `/wallet/create` — so it does not become the app-layer auth the design omits. The reasoning that
  > depended on "sessions gate no authority" is superseded (see the architecture-analysis update);
  > the impact-if-leaked is now bounded by expiry and by the capability's narrow scope, and the id no
  > longer appears in a logged URL (routes moved the id to the header/body) or in the audit log (a
  > truncated `sha256` ref is stored, never the raw id). Enumeration/mass-revoke are closed:
  > listing/revoke require a live capability for that exact account.

- **M2 — deploy-instance has no spend cap of its own `[my code]`** — `policy-service/src/server.ts:156`.
  Sole caller-side throttle is the ineffective gateway per-IP limit; distributed callers drain
  faster than 120/min implies. **Fix:** global/per-sponsor deploy budget in policy-service.

- **M3 — Spending-limit tumbling window allows 2× the limit `[my code]`** —
  `contracts/policy-templates/spending-limit/src/lib.rs:281-284` (identical in token variant
  `:317-320`). Full cap just before reset + full cap just after = 2× across a boundary; the
  documented invariant is off by 2×. Overflow is _safe_ (`overflow-checks=true` + `checked_add`,
  panic on None). **Fix:** true sliding window, or document the 2× honestly.

  > **Status (FIX 10): CLOSED by documentation — behavior UNCHANGED.** This is a product
  > decision, resolved as "keep tumbling, fix every claim" (Option B). The contract is not
  > modified; the 2× boundary property is now stated honestly everywhere and PINNED by tests:
  >
  > - The contract module doc (`spending-limit/src/lib.rs:18-23`) now describes the FIXED
  >   (tumbling) window and the up-to-2×-across-a-boundary behavior explicitly.
  > - Two tests assert the property in BOTH directions
  >   (`spending-limit/src/test.rs`: `boundary_allows_up_to_two_times_limit` and
  >   `boundary_does_not_allow_more_than_two_times_limit`). A future change to the reset logic
  >   (e.g. to a sliding window) breaks the first test — flagging that the documented contract
  >   changed, in either direction.
  > - The UI copy was corrected: the policy-builder header, the spending-limit card description,
  >   and the review-step paragraph (`apps/web/app/policies/page.tsx`), plus the template registry
  >   source of truth (`services/policy-service/src/templates.ts` — description AND comments).
  >   The `apps/docs/` "rolling window" mislabels are corrected in a separate docs commit.
  >
  > **Why Option A (sliding window in the contract) was REJECTED:** a sliding window is a new
  > wasm hash, so **existing deployed policy instances keep tumbling semantics until detached and
  > re-attached** — Option A would split users across two different guarantees with **no external
  > way to tell which a wallet has** (the deployed contract id doesn't reveal the semantics). It
  > also adds storage + gas on every guarded transfer. Given the docs already recommend pairing
  > this policy with an authenticated co-signer for a hard cap, the 2× is a bounded, documented
  > guardrail property, not a defect. **Revisit A only if the spending limit ever becomes a
  > standalone security boundary rather than a co-signer-paired guardrail.**
  >
  > **UI-vs-docs asymmetry worth knowing:** the UI header claimed an EXTERNAL AUDIT the policy
  > contracts have not had ("Policies come from audited templates … not by a promise"). No audit
  > report exists in the repo or git history; the only audited artifact is the external
  > kalepail/passkey-kit smart wallet, which these policies depend on but did not write (the
  > contracts even self-disclaim "audited" — `verified-recipient/src/lib.rs:16`,
  > `attestation-registry/src/lib.rs:14`). By contrast, `apps/docs/` was already accurate — it
  > correctly attributes the audit to passkey-kit and says the policy contract is "testnet only,
  > not yet audited for mainnet." The docs were written carefully; the UI string was not. **Takeaway:
  > review UI strings whenever a contract's behavior is documented — that's where overclaims slip in.**

- **M4 — verified-recipient bricks all covered transfers with no live registry `[my code]`** —
  `contracts/policy-templates/verified-recipient/src/lib.rs:184-205`. As a required co-signer it
  rejects the whole auth for any unattested contract; `is_verified` returns false for
  missing/expired records. No mainnet attestation registry is deployed
  (`policy-service/src/templates.ts:48` is a testnet ID), so a `verified_only` policy on mainnet
  rejects every covered transfer. **⚠ See V3 — this may be permanent fund lock, re-rated below.**
  **Fix:** gate `verified_only` out of the mainnet policy builder until a mainnet registry is
  deployed and pinned per-network.

- **M5 — Attestation registry is a single-key oracle `[my code]`** —
  `contracts/attestation-registry/src/lib.rs:124-180`. One `ATTESTOR_SECRET_KEY` compromise
  forges provenance for any contract and can rotate itself away; the entire verified-recipient
  trust layer = one hot G-key on an internet-facing worker. **Fix:** attestor as
  multisig/smart-account so `require_auth` enforces threshold on-chain.
  **Status (FIX 4): DEFERRED behind a hard guard.** M5 is only exploitable once a _mainnet_
  registry exists, and none does — the deployed registry is testnet. Rather than ship an
  untested smart-account attestor now, the worker refuses to wire the single-key attestor
  against a mainnet registry (`assertAttestorSafeForNetwork`,
  `services/worker-service/src/attestor-guard.ts`): boot fails on the mainnet passphrase unless
  `ALLOW_SINGLE_KEY_ATTESTOR=1` is set. The single-key attestor keeps working on testnet. The
  intended design when mainnet is scheduled:

  > **Smart-account attestor.** Make the registry's attestor a Soroban smart-account
  > (C-address) rather than a single G-key. `attestation-registry`'s `upsert`/`revoke`/
  > `set_attestor` already gate on `require_auth(attestor)` (`lib.rs:124-180`), so pointing the
  > stored attestor at a C-address means the account's own `__check_auth` enforces an M-of-N
  > threshold (or a policy) on-chain — no registry-contract change to the auth model. The worker
  > then submits `upsert`/`revoke` _through_ that account (co-signing to threshold) instead of
  > signing with a lone keypair (`registry-submitter.ts:39`). A single host compromise is then
  > insufficient to forge provenance. (Ed25519 classic multisig was rejected: Soroban
  > `require_auth` on a G-account checks a single ed25519 signature and does not compose with
  > classic multisig thresholds.)

- **M6 — DB fallback fails open + health lies `[my code]`** — `service-kit/src/index.ts:49-64`,
  `wallet-service/src/index.ts:31-61`. No `DATABASE_URL` (or transient unreachability — Render
  free Postgres expires at 30 days) → silent in-memory repos, `/health` still returns
  `{status:ok}`. Loses audit log, session list, passkey-dedupe on every restart. _Downgraded
  from High:_ the map is not the ownership gate (on-chain is), so this is durability / audit-
  integrity / availability, not authz bypass. **Fix:** DB-probing `/health` → 503 when
  in-memory in production; fail-closed boot when `DATABASE_URL` is set-but-unreachable (mirror
  worker-service, which already `exit(1)`s).

- **M7 — No reaper for stranded `building` rows `[my code]`** —
  `worker-service/src/pg-job-store.ts:16-30`, `loop.ts:37-62`,
  `verification-service/src/server.ts:149-190`. A crash mid-build strands a job forever
  (`claimSubmitted` only selects `submitted`); unauthenticated undeduped submit floods the
  single global queue. **Fix:** reclaim `building` rows older than an interval; dedupe/throttle
  submissions per contract; bound retries.

- **M8 — Stale fast-uri override `[dependency]`** — `pnpm-workspace.yaml:24-25`. Override pins
  `4.1.1` but the advisory (GHSA host-confusion) fix is `>=4.1.2`; the vulnerable version is in
  the **live backend** fastify/ajv stack, not just dev tooling. **Fix:** bump override to
  `fast-uri@4: ">=4.1.2"`, regenerate lockfile, add `pnpm audit --audit-level=high` to CI.

- **M9 — Deploy from `main` with tsx, no build/typecheck/audit gate `[my code]`** —
  `services/all-in-one/package.json` (start = `tsx`, no build), `render.yaml:22-23`. Push-
  triggered; CI runs typecheck/test/build but is not wired as a deploy precondition and no
  in-repo branch protection enforces it. _Downgraded from High:_ requires push-to-main access
  (insider/token compromise); only committed target is testnet; the self-merge vector was
  **refuted** (`close-prs-*.yml` only _close_ PRs — no checkout, no merge). **Fix:**
  `autoDeploy: false`, required status checks on main, `pnpm audit` gate.

  > **Status (FIX 11): PARTIALLY CLOSED — repo-side done, two settings remain manual.**
  > Done in-repo on this branch:
  >
  > - **`pnpm audit --audit-level=high` added to CI** (`.github/workflows/ci.yml`, after Install):
  >   a newly-introduced high/critical advisory now blocks the build. Currently green (FIX 8 took
  >   the count to 0 high).
  > - **`autoDeploy: false` on the Render service** (`render.yaml`): Render no longer ships every
  >   push to `main`; deploy is a manual/tagged action after CI passes.
  >
  > **Remains MANUAL (cannot be set from a committed file — dashboard/settings only):**
  >
  > 1. **GitHub branch protection on `main`** — mark the `ci` check (and, if desired,
  >    `pnpm audit`) as a **required status check**, and require PRs (no direct pushes). This is
  >    a repo Settings → Branches value; nothing in the repo can enforce it.
  > 2. **Railway `autoDeploy`** — `railway.json` has no autoDeploy field; Railway's auto-deploy is
  >    a dashboard setting. If Railway is a live target, turn it off there too (or confirm Render
  >    is the only deploy target and Railway is unused).
  > 3. **Confirm which platform is actually live** (V6, still open) — the gate only matters on the
  >    platform that deploys. If only Render is live, item 2 is moot.
  >
  > Until the branch protection (item 1) is set, CI is a signal, not a gate — a maintainer can
  > still merge red. The repo-side changes make the gate _possible_; the dashboard settings make
  > it _binding_.

---

## 🟢 LOW

- **L1 — `POST /policies/deploy` writes an unverified `deployed` flag from the request body
  `[my code]`** — `policy-service/src/server.ts:206-222`. _No client renders trust from it
  today_ (verified: UI shows "attached" only after a real passkey-signed on-chain attach via
  `apps/web/lib/policy.ts:82-93`). Latent; harden before any consumer trusts it. **Fix:** verify
  the txHash on-chain before stamping `deployed`.

  > **Status (FIX 12/L1): CLOSED by verification, NOT by removal.** The field is kept (it is the
  > canonical "this policy is now attached" record `deployPolicy` returns), but `/policies/deploy`
  > now **decodes the client-supplied tx and confirms it actually attached THIS policy to THIS
  > wallet** before stamping `deployed` (`services/policy-service/src/verify-attach.ts`):
  >
  > - The tx must exist and have SUCCEEDED on the **server-config network** (the lookup is bound to
  >   config's RPC, never the request body — V5), invoked `add_signer`/`update_signer` on the
  >   record's **wallet**, and carry the record's **policy contract id** in the signer args (found
  >   by recursively scanning the ScVal args, so the address inside the nested `Signer::Policy`
  >   enum is matched). The wallet is now persisted on `record.instance` at `/deploy-instance` so
  >   there is something to verify against.
  > - **Two failure modes are distinguished** so an operator can tell "can't reach chain" from
  >   "you lied": `AttachUnconfirmedError` → **503** (RPC unreachable or tx NOT_FOUND — fail closed,
  >   retryable, not stamped); `AttachMismatchError` → **422** (tx FAILED, or attached a different
  >   policy/wallet, or is an unrelated call — a definite lie).
  >
  > **Why the "exists + succeeded" check was REJECTED:** that only defeats `txHash: "00…"`. Any
  > successful hash on the network passes, and the chain is a public list of those (our own docs
  > publish testnet hashes) — the attacker's cost goes from typing zeros to copy-pasting. Worse, it
  > would hand a future consumer a field that _looks_ verified and isn't, so the next person won't
  > re-derive the weakness. Same standard as **FIX 2**: verify that the tx equals the expected
  > attach, not that it is a plausible tx. Tests: an unrelated same-network tx → 422; a tx attaching
  > a different policy → 422; this policy to a different wallet → 422; the legit flow → 200; RPC
  > unreachable → 503 (not stamped).

- **L2 — Downstream services bind `0.0.0.0:4001-4004` with no middleware `[my code]`** —
  `service-kit/src/index.ts:88`. _Downgraded to Low:_ committed configs publish only `$PORT`,
  so not internet-reachable via the public URL today; residual defense-in-depth + shared
  private-network exposure. **⚠ See V4 — composes with H2 when worker is co-located.** **Fix:**
  bind `127.0.0.1` for co-located services; only the gateway binds `0.0.0.0`.

- **L3 — No web-app-origin allowlist on `pair` `[my code]`** — `extension/lib/router.ts:37-39`,
  `background.ts:164-186`. Any site can pair, supply an attacker RPC, and become the extension's
  deep-link target (phishing). Downgraded (needs user to open attacker page; passkey still gates
  signing). **Fix:** env-configured allowlist of canonical Vellar web origins.

  > **Status (FIX 12/L3): CLOSED.** `routeProviderRequest` now gates `pair` on a fail-closed
  > web-app-origin allowlist (`apps/extension/lib/pair-origins.ts` + `router.ts`); an off-list
  > origin is refused `unauthorized` **before any approval popup**, so an attacker page can never
  > become `webAppOrigin` or seed the paired `rpcUrl` (which closes L4's precondition).
  >
  > The allowlist is resolved **fail-closed, matching FIX 7's boot posture** — it does not
  > silently degrade the way the in-memory DB fallback would:
  >
  > - **Trust signal:** the dev/prod split keys off `import.meta.env.COMMAND` (`"build"` vs
  >   `"serve"`), which WXT/Vite **injects at bundle time per artifact** — a _runtime_ env var
  >   cannot spoof it, unlike a `NODE_ENV` read. (`import.meta.env.MODE` would work too;
  >   `COMMAND` is the WXT-native, typed one in `.wxt/types/globals.d.ts`.)
  > - **Dev build, nothing configured:** falls back to `http://localhost:3000` / `:5173` only.
  > - **Production build, nothing configured:** `pairOriginPolicy()` **throws**; the background
  >   worker catches it and sets the policy to `[]` — **pairing is disabled**, not opened to
  >   localhost or to any origin. An unconfigured prod artifact simply cannot pair.
  > - **Escape hatch is named + warned, never silent:** `WXT_PUBLIC_ALLOW_ANY_PAIR_ORIGIN=1`
  >   (same shape as `ALLOW_INMEMORY` / `ALLOW_SINGLE_KEY_ATTESTOR`) disables the restriction and
  >   logs a warning on every startup; it is in no committed manifest.
  > - Origins come from `WXT_PUBLIC_WEB_APP_ORIGINS` (comma-separated), each canonicalized through
  >   `normalizeOrigin` (a single trailing slash tolerated; paths/junk dropped); documented in
  >   `apps/extension/README.md`.
  >
  > Tests (`pair-origins.test.ts`, `router.test.ts`): dev+empty → localhost only; prod+empty →
  > throws (no fallback); prod+origins → exactly those; a non-listed origin → refused in both
  > modes; the `"any"` escape hatch → any origin may pair.

- **L4 — Device signing consults attacker-controllable `rpcUrl` for the expiration ledger
  `[dependency]`** — `extension/lib/tx-signer.ts:56-61,83`. Precondition is L3; an inflated
  `getLatestLedger` widens the on-chain validity window for that one signed entry. **Fix:** use
  the extension's own per-network RPC, or pass a locally-bounded explicit expiration.

  > **Status (FIX 12/L4): CLOSED.** Both halves of the fix are applied: the anchor now comes from
  > a **trusted per-network RPC** and the window is **explicitly capped**, so the caller-supplied
  > `wallet.rpcUrl` is entirely out of the expiration path (`apps/extension/lib/signer-expiration.ts`
  >
  > - `tx-signer.ts`).
  >
  > passkey-kit, given no explicit `expiration`, calls `getLatestLedger()` on `wallet.rpcUrl` and
  > sets `signatureExpirationLedger = latest + timeout/5` (verified in `passkey-kit@0.14.0`
  > `kit/tx-ops.js:26,49-57`); it only asserts the result is a u32, no upper bound. `signAuthEntry`
  > accepts an explicit `expiration` and, when supplied, **never calls `getLatestLedger`** — so we
  > supply one:
  >
  > - **Trusted anchor (Option C).** `resolveTrustedRpcUrl` returns SDF's pinned
  >   `https://soroban-testnet.stellar.org` for testnet, and the build-time
  >   `WXT_PUBLIC_MAINNET_RPC_URL` for mainnet — neither is the paired `rpcUrl`. Mainnet with no
  >   configured RPC **fails closed** (`TrustedRpcUnavailableError`); the anchor fetch itself
  >   propagates transport errors rather than falling back to the caller endpoint. Chosen over
  >   reading the tx's own ledger bounds (Soroban txs often carry none, and a control that rejects
  >   correct transactions gets removed by whoever hits it first).
  > - **Capped window.** `boundedExpirationLedger` adds **exactly `MAX_EXPIRATION_LEDGERS = 60`**
  >   (~5 min at ~5s/ledger) — the ADDED span is never anchor-proportional, so an inflated anchor
  >   cannot widen it — clamped to u32. 60 is a deliberate approval-latency-vs-replay-window
  >   tradeoff: it must cover the worst realistic approval (user gets the popup, switches apps,
  >   returns, approves), and the replay exposure traded away is small — the device key is already
  >   a 7-day expiring co-signer, further bounded by attached policies.
  > - **Nothing else in the signing path trusts `wallet.rpcUrl` for a security-relevant value.**
  >   `connectWallet` uses it to confirm the wallet exists and the keyId is a signer, but the
  >   wallet binding is re-asserted locally (`kit.contractId === wallet.address`, and `contractId`
  >   is a deterministic local derivation, not an RPC claim), and a lying "you are a signer" cannot
  >   forge a signature — the device key signs and the real network validates at submit. Only the
  >   expiration is baked into the signed payload, and that is what this fix removes from the RPC.
  >
  > Tests (`signer-expiration.test.ts`, `tx-signer.test.ts`): the added span is always exactly the
  > cap regardless of anchor size; the cap is 60; mainnet with no RPC throws and signs nothing; the
  > wired signer fetches the anchor from the pinned testnet endpoint (asserted `!= wallet.rpcUrl`)
  > and passes the capped `expiration` to `signAuthEntry`.

- **L5 — `normalizeOrigin` accepts trailing-dot FQDNs as distinct principals `[my code]`** —
  `provider-sdk/src/permissions.ts:38-49`. UX confusion only; the browser scopes storage per
  origin so no privilege inheritance. **Fix (optional):** strip a single trailing dot.

  > **Status (FIX 12/L5): CLOSED.** `normalizeOrigin` now collapses a single trailing dot on the
  > host (`app.example.com.` → `app.example.com`) by stripping it from `url.hostname` and letting
  > the URL recompute the origin (so host + port stay consistent). The existing bare-origin guard
  > (`url.origin !== value`) still runs first, so a dotted host with a path/query is rejected before
  > the strip, exactly as before. Only ONE dot is removed — a doubled dot stays distinct, since we
  > canonicalize the one real FQDN convention, not arbitrary garbage. Tests (`permissions.test.ts`):
  > the dotted and dotless forms map to the same normalized origin (incl. with an explicit port and
  > on `localhost.`); a doubled trailing dot is not collapsed to the clean form.

- **L6 — Cleanup builder emits all ops into one tx + unpaginated `as`-cast Horizon reads
  `[my code]`** — `lifecycle-service/src/builder.ts:44-103`, `horizon.ts:44-95`.
  Correctness/DoS, **not** fund theft (every tx is unsigned; the user must sign). **Fix:** split
  by `OPS_PER_TX=100`; add fetch timeouts; paginate/validate Horizon responses.
  - **L6b — "Safe account cleanup" copy overclaim `[my code]`** — `apps/web/app/page.tsx:46`
    (live landing) names the cleanup feature "Safe account cleanup." Cleanup **moves funds and
    merging classic accounts is irreversible**, so "safe" is a claim, not a label. Surfaced while
    fixing M3's overclaims (grep for "safe"). Handle the copy in the same pass as the L6 cleanup-
    builder work (right context — the builder + its promise reviewed together). The gitignored
    `landing-page/VELA Landing.html` has the same string but does not ship; leave it.

  > **Status (FIX 12/L6): CLOSED.** All four parts fixed, with the L6b copy in the same pass so the
  > builder and its user-facing promise stay in agreement.
  >
  > - **Op-split.** `buildCleanupSteps` (`lifecycle-service/src/builder.ts`) now collects every
  >   cleanup operation and splits by `OPS_PER_TX = 100` — Stellar's hard protocol limit (a 101-op
  >   tx is rejected with `txTOO_MANY_OPS`; the SDK does not guard it client-side, so the old
  >   single-tx build silently produced an invalid tx for >100-op accounts, despite the "can re-run
  >   the wizard" comment). Split transactions share one `Account` source, so they carry
  >   **consecutive sequence numbers** and the user signs/submits them in order; each step is
  >   titled `(n/total)`.
  > - **Planner agreement.** `buildCleanupPlan`'s `estimatedTransactions` now counts the REAL op
  >   count (a "N open offers" blocker is one row but N cancel ops; a non-zero balance is two ops),
  >   so the estimate no longer under-reports the number of transactions the builder emits.
  > - **Horizon reads validated + paginated + timed out.** `createHorizonAccountReader`
  >   (`horizon.ts`) replaces the `as`-casts with **zod** runtime validation (a malformed body
  >   throws a clear "Horizon … was malformed" error, not a cryptic `.map of undefined` in the
  >   builder), follows `_links.next` to collect **all** offer pages (the old `?limit=200` read
  >   only the first page, so a >200-offer account would clean up incompletely and fail the merge),
  >   guards against a self-referential `next` (stops on an empty page, capped at `maxOfferPages`),
  >   and wraps every request in an `AbortController` **timeout** so a hung Horizon can't stall.
  > - **L6b copy.** The landing card is retitled **"Guided account cleanup"** and its body now
  >   states plainly that closing an account moves its funds and can't be undone — the honest
  >   guarantee (guided, reviewable, you sign every step), not "safe". The gitignored landing HTML
  >   is left as-is (does not ship).
  >
  > Tests: `builder.test.ts` (no step exceeds 100 ops; 250 ops → 3 txs summing to 250; consecutive
  > sequences; non-zero balance = 2 ops); `server.test.ts` (150 offers → 3 transactions estimate;
  > 100 non-zero balances → 3); `horizon.test.ts` (404 → undefined; non-ok → throws; malformed body
  > → clear error; offers collected across pages; empty-page guard; timeout aborts).

- **L7 — 14 high dependency advisories (0 critical) `[dependency]`** — `pnpm-workspace.yaml:16`.
  Most reachable ones config-mitigated (no http2 → find-my-way DoS inert). **Fix:** add
  `pnpm audit` to CI; bump `next` to `>=16.2.11`; update the wxt dev chain.

---

## ℹ️ INFO

- **I1 — Attacker-controlled PR filenames rendered into the bot comment body `[my code]`** —
  `.github/workflows/close-prs-outside-contrib.yml:31-42`. Markdown injection, **no code
  execution**. Both `close-prs-*.yml` do no checkout, run only parameterized `github-script`,
  and there is **zero `${{ }}` interpolation** across all workflows — the RCE class is absent.
  **Fix:** escape filenames before embedding; do **not** add a checkout step.

---

## Remediation order

**Before any mainnet key is configured (blocking):**

1. **C1** — scope the sponsor to Vellar wallet operations (the one place the on-chain gate does
   not cover the side effect; direct drain of real funds).
2. **H1 / M2** — sponsor spend budget + lower fee bids + wallet-must-exist check for deploys.
3. **M5** — attestor as multisig/smart-account before any mainnet registry goes live.
4. **M4** — gate `verified_only` out of the mainnet policy builder until a mainnet registry
   exists (see V3 re-rating).

**Before public testnet exposure (a real build box / public submit endpoint):** 5. **H2 + H3** — repoUrl allowlist + private build logs. 6. **M1** — ~~authorize session read/revoke with the caller's own session id~~ **DONE** (RA-3/M1: bearer session capability, 7-day sliding expiry, hashed audit ref). 7. **M6** — fail-closed boot + DB-aware health. 8. **M8** — bump fast-uri.

**Can wait (hardening / latent):** M3, M7, M9, L1–L7, I1.

_(Remediation order is revised in the V1–V6 follow-up below.)_

---

## V1–V6 Follow-up — deeper verification of the load-bearing claims

Six questions that could change the remediation plan were traced to code (two via investigators
reading the pinned passkey-kit source and the installed `passkey-kit@0.14.0` derivation code).
Verdicts below; three of them changed the plan.

### V1 — `/wallet/create` derivation gate is available. **CONFIRMED**

The create tx goes to the **relayer**, not the sponsor: `createHybridSubmitter`
(`wallet-service/src/index.ts:17-25`) routes to the sponsor only when
`needsSponsorRebuild` is true (`sponsor.ts:26-39`), and a wallet deploy carries
**source-account (deployer) auth**, so the predicate is false → relayer fallback.

The smart-account address is a **secret-free pure function of the keyId** under the pinned
scheme (`node_modules/…/passkey-kit/dist/utils.js:28-37`):
`salt = sha256(keyId)`; `deployer = Keypair.fromRawEd25519Seed(sha256("kalepail"))`
(`constants.js:56`, public, no secret); `contractId = StrKey.encodeContract(sha256(HashIdPreimage{
networkId: sha256(passphrase), fromAddress(deployer, salt)}))` — **wasm hash is not an input**.
The client uses this default deployer (`apps/web/lib/connector-factory.ts:57-61`, no `deploySource`).
Every input is in the create body (`keyId`) or a pinned constant, so the server can reject unless
`deriveContractAddress(keyId, pinnedDeployer, pinnedPassphrase) === body.contractId` — a one-line
check using the **already-exported** symbol at `passkey-kit/dist/index.js:31`. Today
`server.ts:76-107` does none of this. This is the same invariant the keyId "client-authoritative"
refutation rested on, so **the refutation stands and the fix and the refutation are one fact.**

> **⚠ Limitation of the derivation gate — do NOT read `existsByContractId` as authentication.**
> FIX 2 proves only that `contractId == derive(keyId)`, i.e. it binds the address to the keyId. It
> does **not** prove a genuine WebAuthn authenticator exists or that a real user controls the key: a
> scripted P-256 keypair produces a perfectly valid self-authored deploy and a matching
> `derive(keyId)` contractId. So a "recognized wallet" (a row in the wallets table, checked by
> `WalletRepository.existsByContractId`) is a **metering and scoping primitive only** — it bounds
> _which_ contracts the funding paths will pay for, and lets budgets attribute spend to a wallet. It
> is **never** an identity, trust, or ownership signal, and no future code may treat it as one
> (e.g. to gate a sensitive action, render a "verified user" badge, or skip an on-chain check). The
> only real authority remains the passkey signature validated on-chain by `__check_auth`.

### V2 — The relayer is a second unscoped funding source. **CONFIRMED**

`createHybridSubmitter` sends anything failing `needsSponsorRebuild` to the **relayer**
(`sponsor.ts:114-117`), funded by `RELAYER_API_KEY`, reachable unauthenticated via the same
routes. **C1's sponsor-only scoping does not cover the relayer branch** — scoping must happen at
the route, before the submitter selects a branch, or the abuse simply relocates to the relayer.

### V3 — M4 is NOT permanent fund lock. **REFUTED → M4 stays Medium (availability)**

The pinned smart-wallet source is readable
(`~/.cargo/git/checkouts/passkey-kit-…/50981cc/contracts/smart-wallet/src/lib.rs`).
`remove_signer` runs **no policy code** (`:302-308`, explicit comment that calling the policy
there would let a rejecting policy block its own removal), and `__check_auth` has an
`is_sole_self_removal` exception that **skips consulting a policy** when the only context is that
policy's own removal (`:433-449`, `context.rs:15-45`). In this repo the policy attaches as a
standalone `SignerLimits(None)` signer (`connector-factory.ts:107-124`), so the admin passkey
removes it alone. Recovery = one `remove_signer(SignerKey.Policy(<addr>))` — **but there is no
wired detach UI** (`policy.ts` exposes only attach/deploy), so recovery today needs a direct
`kit.remove(...)` SDK call. **This safety depends on the attach shape**, which is app code, not
the contract — so a test must pin it.

### V4 — H2+L2 do NOT compose into sponsor spend. **REFUTED (as spend) / CONFIRMED (as reachability)**

A co-located worker's host-side `git clone` (`executor.ts:163`, `defaultRun` = host `spawn`,
`:292-294`) **can** reach `http://127.0.0.1:4001/4003`, but git smart-HTTP clone issues a **GET**
and every sponsor-spending route is **POST-only** (`server.ts:128,156`) — so no unauthenticated
spend via clone. It **does** confirm the worker reaches internal-only ports the internet cannot,
and H3 reads them back out. **Do not encode "POST-only" as a control** — fix the reachability
(bind `127.0.0.1`, isolate the worker, allowlist repoUrl).

### V5 — `network` is a label, not a routing input. **CONFIRMED**

RPC/passphrase are fixed from env at process start (`config.ts:18-19`); the request `network`
field is used only for storage/metrics/lookup (`server.ts:68,102-105,116,137-138,169`), never for
submission routing. **Rule for all remediation guards: key off server config only, never the
request body's `network`.**

### V6 — Two infra facts remain gated on the dashboard

From committed configs: neither `render.yaml` nor `railway.json` publishes any port beyond the
injected `$PORT`, and neither sets an `autoDeploy`/branch/trigger field. **Provable from repo:**
the repo never asks to expose 4001-4004. **NOT provable from repo (needs dashboard):** whether the
platform edge firewalls the other bound listeners, and whether `autoDeploy` is on. Both manifests
are testnet-only.

### Revised mainnet-blocking order

1. **Scope both funding paths at the route** (C1 + H1 + V2). Validate the tx is a Vellar wallet
   op before the submitter selects sponsor _or_ relayer; lower the sponsor fee bid to
   simulation-derived.
2. **Derivation gate on `/wallet/create`** (V1). Reject unless `derive(keyId) === contractId` —
   closes create as a third funding path and enforces the client-authoritative invariant.
3. **Per-path spend budgets** keyed off server config only (H1/M2/V5); meter `/policies/generate`
   or budget on spend; require the wallet to exist before a sponsored deploy.
4. **Attestor as multisig/smart-account** before any mainnet registry (M5).
5. **Policy attach invariant + detach path** (V3): pin the standalone-signer attach shape with a
   test; wire detach into the web app.
6. **Worker network isolation** (H2+H3+L2+V4): bind downstream to `127.0.0.1`; repoUrl allowlist
   with DNS re-check; split public/private build logs.

**Dropped from blocking:** M4 (availability-only per V3; gate `verified_only` out of the mainnet
builder + add detach UI when that path is enabled).
**Still gated on dashboard (V6):** final severity of L2 (port exposure) and M9 (autoDeploy).

---

## Re-audit of the patched tree (RA) — findings introduced or missed by the remediation

Method: after #228 + #230 merged, the patched tree was re-audited **read-only**, treating all
remediation code as untrusted new surface. Nine parallel hunts (SSRF guard, derivation gate,
route-scoping, spend budget, escape hatches, FIX-12 paths, policy-attach invariant, closure-by-test,
standard sweep); every candidate then adversarially re-verified against the actually-installed code
(the verifier defaulted to _refuting_). Nine findings survived verification. The two Highs sit on the
**funding path** — the exact controls the mainnet gate depends on.

### RA-1 — Route scope gate matches only the **V1** credential string; passkey-kit 0.14 signs **V2** 🔴 High `[my code]`

`services/wallet-service/src/scope.ts:43`; same defect in `apps/extension/lib/tx-signer.ts:101`.

`extractAddressAuthSubjects` filters auth entries with `entry.credentials().switch().name !==
"sorobanCredentialsAddress"` — an exact match on **V1** only. But the production signer
`passkey-kit@0.14.0` **never emits V1 for a signed wallet op**: `kit/tx-ops.js:45` calls
`toAddressBoundCredentials`, which `kit/auth-payload.js:65-67` upgrades every entry **in place** to
`sorobanCredentialsAddressV2`, and `tx-ops.js:46-48` throws unless the payload is V2/with-delegates
("there is deliberately NO V1 signing path"). `@stellar/stellar-sdk@16.0.1` `curr_generated.js:1726-1731`
confirms the enum has V1(1)/V2(2)/with-delegates(3). Two failures:

- **(b) fail-closed BREAK (live on testnet today):** a normal single-op V2-signed wallet tx yields
  `subjects === []` → `assertScopedToKnownWallets` throws `ScopeError('no_wallet_subject')` →
  **HTTP 403 on every legitimate `/wallet/submit`** in the production posture (the gate is live
  whenever `deps.networkPassphrase` is set — `server.ts:203-207`, wired from server config at
  `index.ts:100-111`). Every post-deploy wallet operation is rejected the moment the gate is enabled.
- **(a) scope BYPASS:** a mixed tx with one V1 entry bound to a known wallet + one V2 entry bound to
  an attacker contract yields `subjects === [known]` (V2 skipped at line 43), passes the gate, and
  `needsSponsorRebuild` routes it to the funded sponsor rebuild `{func, auth:[A,B]}` — the V2 leg
  rides past the C1/H1/V2 scope control.

The suite is green only because `scope.test.ts` builds solely V1 / source-account fixtures — the V2
path is never exercised (see the fixture-defect note in RA notes). The identical V1-only filter in
`tx-signer.ts:101` means the extension signer would skip the real V2 entries and sign nothing.

> **Status (RA-1): CLOSED.** `scope.ts` and `tx-signer.ts` now resolve the `SorobanAddressCredentials`
> across **all three** address-bound arms (`sorobanCredentialsAddress` V1, `sorobanCredentialsAddressV2`,
> `sorobanCredentialsAddressWithDelegates` → `.addressCredentials()`) and read `.address()` uniformly;
> source-account is skipped. Fixtures are now kit-shaped: the test builders default to **V2** (the real
> signer output — `toAddressBoundCredentials` upgrades V1 in place) and parametrize over v1/v2/delegates,
> so a V1-only regression fails immediately. `scope.test.ts` adds the mixed V1(known)+V2(attacker) bypass
> case at both the extract and `assertScopedToKnownWallets` levels (the attacker V2 leg is now surfaced
> and rejected); `tx-signer.test.ts` asserts each variant is signed. 13 scope tests + 62 extension tests
> pass; both packages typecheck.

### RA-2 — Spend-budget conditional INSERT is not atomic under READ COMMITTED 🔴 High `[my code]`

`packages/service-kit/src/pg-budget.ts:41`.

`tryConsume` runs check-and-record as a single `WITH agg AS (SELECT SUM(count)/SUM(stroops) FROM
spend_ledger WHERE line/network/at>windowStart) INSERT … SELECT … WHERE agg.sum + N <= max`
statement. The aggregate CTE takes **no row locks** (no `FOR UPDATE`), the INSERT writes a fresh
`randomUUID` row against only a **non-unique** `(line,network,at)` index, and `db/client.ts:19` is a
bare `pg.Pool` with **no isolation override** (default READ COMMITTED; no SERIALIZABLE / `FOR UPDATE`
/ advisory lock anywhere in the repo). N concurrent requests each snapshot the same committed sum,
all pass the `WHERE`, all commit → the ceiling degrades from a hard cap to **ceiling + pool
concurrency**.

`budget.ts:2-4` documents this cap as the **sole** binding funding-path control (the gateway per-IP
limit does not bind — no `trustProxy`). So the overshoot is a direct drain of real sponsor XLM past
the FIX-3 ceiling: fire 8 concurrent `/wallet/submit` (or `/wallet/create` / `/policies/deploy` —
all share `createPgSpendBudget`) against a maxCount=1 boundary → up to 8 sponsored txs land. The
concurrency test that would catch it (`pg-budget.test.ts:112-127`) is `describe.skipIf(!TEST_DATABASE_URL)`
and does not run in ordinary CI, so the atomicity guarantee is **unverified** and would fail against
real Postgres.

> **Status (RA-2): CLOSED.** `pg-budget.ts` now runs the check+insert inside a **transaction**
> guarded by `pg_advisory_xact_lock(hashtext('<line>:<network>'))` **taken before the aggregate
> read**, so same-`(line,network)` callers serialize (lock auto-released at commit) and different
> keys never block each other. Chosen over a unique counter row (would force a tumbling window,
> re-introducing M3's boundary leak in our own ledger) and over SERIALIZABLE+retry (retry loops +
> aborts on the funding hot path).
>
> **A second defect surfaced and was fixed:** the existing concurrency test was **decorative**. It
> both (a) skipped locally behind `skipIf(!TEST_DATABASE_URL)` and (b) fired `Promise.all` over a
> single drizzle pool, which serializes on the pool and never actually raced — so it passed even
> against the broken single-statement code. Proven with real parallel connections (12 own-connection
> consumers, ceiling 1): the old single statement inserted **10 rows** (overshoot); the advisory-lock
> version inserts exactly **1**. The test is rewritten to use N independent single-connection pools
> so it truly races — it now **fails against the pre-fix code and passes with the lock** (verified
> against Postgres 16 via `infra/docker`). Unit tests (`budget.test.ts`, no DB) additionally pin that
> the lock statement is issued **first**, inside a transaction, keyed on `hashtext(line:network)`.
>
> **CI now enforces the guarantee runs:** the workflow already provisions Postgres and passes
> `TEST_DATABASE_URL`; it also sets `CI_REQUIRE_DB=1`, under which the DB integration suites **fail
> rather than silently skip** if the DB ever goes missing — so "the guarantee only holds when a local
> env var is set" can no longer be true in CI. The false "ONE atomic statement" claim in `budget.ts`
> is corrected.

### RA-3 — M1 (session enumeration + revocation) is still OPEN; the doc's own status is stale 🟡 Medium `[my code]`

`services/wallet-service/src/server.ts:254-274`.

`GET /wallet/sessions` (`:254-261`) and `DELETE /wallet/session/:id` (`:263-274`) read only
query/params and enforce **no** ownership or bearer credential. An unauthenticated attacker who
learns a victim's public C-address (it is on-chain) can enumerate every active session id + metadata
(`GET …?contractId=<victim>`), then `DELETE` each → log the victim out of all devices. M1 has **no**
"Status: CLOSED" block and still sits on the pre-exposure checklist (Remediation order item 6), yet
its Fix ("authorize read/revoke with the caller's own opaque session id as a bearer capability") was
never implemented. Impact is bounded — sessions gate **no** on-chain authority (authorization is
on-chain via `__check_auth`; web connected-state derives from SDK localStorage) — so this is device-
management DoS + session-graph disclosure, **not** an authz bypass.

> **Status (RA-3): CLOSED (branch `security/session-capability`).** Implemented as a bearer session
> capability, and the finding's own premise ("sessions gate no authority") was updated everywhere it
> was reasoned from, not just where it was stated:
>
> - **Guard.** `GET /wallet/sessions`, the new `GET /wallet/session` (own session), and the new
>   `POST /wallet/sessions/revoke` all require `Authorization: Bearer <sessionId>` resolving to a
>   **live** session **bound to the exact account** being read/revoked. Missing / unknown / expired /
>   wrong-account bearer all return an identical `401 unauthorized`, so no response reveals whether an
>   id was ever valid. Enumeration and cross-account mass-revoke are closed.
> - **Expiry.** Sessions now carry `expires_at` (schema migration `0002`) and expire on a **7-day
>   sliding window** matching the device signer (`SESSION_TTL_MS`; noted in-code that the two
>   lifetimes are coupled). `find`/`listByContract` treat an expired row as **absent**; `touch` slides
>   `lastActiveAt`+`expiresAt` only on an authorized use, so a rejected/expired id cannot extend its
>   own life. This fixes the pre-existing never-updated `lastActiveAt` (it was harmless for a label,
>   not for a capability).
> - **No credential in logs.** The id moved out of the URL (path/query) into the header/body —
>   Fastify logs URLs but not headers/bodies — and the audit log stores a **truncated `sha256(id)`**
>   ref, never the raw id.
> - **No auth drift.** A non-drift test asserts a valid session id on `Authorization` grants nothing
>   on `/wallet/submit` or `/wallet/create` (they still validate their own bodies) — the capability
>   stays narrow and does not become the app-layer auth the design deliberately omits.
> - **Premise sweep.** The "not an access token / gates no authority" reasoning in
>   `docs/architecture-analysis.md` (the "What passes for a session" + "Where authorization is real"
>   passages) and in the M1 finding above was corrected — a conclusion built on the old premise, not
>   just the sentence, so a later reader doesn't re-derive the stale rating.

### RA-4 — `ALLOW_INMEMORY` fail-closed boot guard is **inert** on the deploy targets 🟡 Medium `[my code]`

`packages/service-kit/src/persistence.ts:29,41,56`.

`isProduction` is a strict `nodeEnv === "production"` and gates both fail-closed branches. The
deployed process (`@vellar/all-in-one`) starts via `tsx … src/index.ts` with **no `NODE_ENV`**, and
**no committed config** (`render.yaml` envVars, `railway.json`, `.env.example`) sets it — confirmed
by repo-wide grep; neither platform injects it by default. So at runtime `isProduction(undefined) ===
false`: when `DATABASE_URL` is set but unreachable, the guard falls through to `allow-inmemory` and
`/health` reports ok. This **silently undoes FIX 7 (M6) on the actual deploy target** — and
`render.yaml:8` warns the free Postgres **expires at 30 days**, exactly the DB-gone failure mode
where audit log, sessions, and the FIX-3 spend budgets would reset to volatile in-memory while
health monitoring says healthy. Downgraded High→Medium only because both manifests are testnet-only.

> **Status (RA-4): CLOSED — by inverting the default, not by patching the manifest.** Setting
> `NODE_ENV=production` in the deploy config would work only until the next target that forgets it —
> a missing env var still meaning "less safe" is the bug. Instead the polarity is inverted: in
> `packages/service-kit/src/persistence.ts`, in-memory is now the branch that requires an **explicit**
> signal, and **absence fails closed**:
>
> - `resolvePersistencePolicy` degrades to in-memory only on an **explicitly ephemeral** env
>   (`NODE_ENV === "development" | "test"`) or the operator opt-in `ALLOW_INMEMORY=1`. An **unset**
>   `NODE_ENV` — the deploy-target reality — no longer degrades; with no usable durable DB it returns
>   `fail` and the service `process.exit(1)`s. The wallet- and policy-service call sites feed
>   `process.env.NODE_ENV` straight in, so they inherit the fix.
> - Local dev keeps working because the `dev` scripts now set `NODE_ENV=development` explicitly
>   (7 services), and Vitest sets `NODE_ENV=test`; the deployed `start` scripts stay unset, so they
>   fail closed unless a DB is wired (which `render.yaml`/`railway.json` do) or `ALLOW_INMEMORY=1` is
>   set. The signal is now the presence of an explicit dev marker, never the absence of a prod one.
> - A regression test pins the exact deploy-target case (`nodeEnv: undefined` + no/unreachable DB →
>   `fail`) that had no coverage before.
>
> **Repo-wide inertness sweep (per the RA-4 directive "if this one was wrong, others likely are").**
> 19 environment-signal checks audited; 7 were the same "unset ⇒ less-safe" shape. Dispositions:
>
> - **Fixed here (same NODE_ENV persistence class):** `persistence.ts` (the anchor) + its wallet/
>   policy call sites (auto-fixed). **`verification-service/index.ts` was the worst case** — it had
>   **no `resolvePersistencePolicy` and no NODE_ENV backstop at all**, always silently falling back to
>   an in-memory store on unset/unreachable DB; it now uses the same fail-closed policy.
> - **New latent finding, filed as RA-10 (separate mechanism, not fixed here):** `attestor-guard.ts:16`
>   keys the mainnet single-key guard on an **exact passphrase match**, so an unset
>   `STELLAR_NETWORK_PASSPHRASE` defaults to testnet and **silently bypasses** the M5 guard if a worker
>   is pointed at mainnet without setting the passphrase. Requires the attestor to be enabled; tracked
>   for the M5 work.
> - **Already-documented conditional guards (not new):** the sponsor/relayer scoping
>   (`wallet-service/server.ts:109`, wired only when the relayer is configured) and the L1
>   attach-verify (`policy-service/server.ts:97`, wired only when RPC is available) are "absent config
>   ⇒ skip guard" in shape, but both are intended — the guarded funding/deploy path is itself inert
>   without that config. The `VERIFY_BUILD_IMAGE` stub switch is loud + already documented. No change.
> - **Confirmed CORRECT (fail-closed) — do not touch:** the extension's `import.meta.env.COMMAND`
>   (unset ⇒ `build`/strict), `WXT_PUBLIC_ALLOW_ANY_PAIR_ORIGIN`, `ALLOW_SINGLE_KEY_ATTESTOR`, worker
>   `DATABASE_URL`, and the gateway CORS/rate-limit/body-cap defaults. The extension is the reference
>   for the right shape: absence yields the safe branch.

### RA-10 — `attestor-guard` mainnet check is bypassed by an unset passphrase ℹ️ Info → tracked with M5 `[my code]`

`services/worker-service/src/attestor-guard.ts:16`. `attestorNetwork` returns `"mainnet"` only on an
**exact** `MAINNET_PASSPHRASE` match; an unset `STELLAR_NETWORK_PASSPHRASE` defaults to the testnet
passphrase (`config.ts:53`), so a worker pointed at a mainnet RPC/registry while forgetting the
passphrase mis-classifies as testnet and the single-key-on-mainnet refusal (M5) **silently does not
run**. Surfaced by the RA-4 inertness sweep. Same class as RA-4 (unset ⇒ less-safe) but a different
signal (network passphrase, not `NODE_ENV`), and it only bites when the attestor is enabled
(`ATTESTOR_SECRET_KEY` + `ATTESTATION_REGISTRY_ID` set).

> **Status (RA-10): OPEN — tracked with M5.** M5 (attestor-as-multisig) is already a deferred mainnet
> prerequisite; fold this in there. Fix direction: derive the attestor's network from the same
> explicit signal the rest of the mainnet posture uses and fail closed when the passphrase is unset
> but a mainnet registry/RPC is configured, rather than defaulting the classification to testnet.

### RA-5 — Cleanup builder pays the full asset balance **before** cancelling offers (ignores selling liabilities) 🟡 Medium `[my code]`

`services/lifecycle-service/src/builder.ts:59` (+ `horizon.ts` never parses `selling_liabilities`).

`collectCleanupOps` emits every non-native payment at `amount = balance.balance` (the **full**
trustline balance) and its trustline removal, and only **afterward** the offer cancels — so payments
always precede cancels in the op list. For an account holding an asset it also has an open offer
selling (100 USDC held, 40 USDC on offer), the payment of 100 hits the 40 locked as a selling
liability → `op_underfunded` → whole tx `txFAILED`. Guided cleanup can never complete for a common
real account state, and the wizard surfaces a raw `op_underfunded`. No fund loss (txs are unsigned)
and the `/lifecycle/merge` preflight re-inspects live state (409 while blockers remain), so no
irreversible merge on partial cleanup — a liveness/correctness bug, not a safety one. Untested.

> **Status (RA-5): OPEN.** Cancel offers before payments (or subtract `selling_liabilities` from the
> paid amount); parse `selling_liabilities` in `horizon.ts`; add a balance-plus-same-asset-offer test.

### RA-6 — V3 detach invariant is pinned only at the pure helper; the attach/detach wiring is untested 🟡 Medium `[my code]`

`apps/web/lib/connector-factory.ts:123`.

V3's refutation of permanent fund lock holds **only** because the policy attaches as a standalone
`SignerLimits(None)` signer, triggering the wallet's `is_sole_self_removal` exception on detach. That
fund-lock-critical shape lives entirely in the pure helper `policyAttachArgs`; `policy-signer.test.ts`
asserts only the helper in isolation, `policy.test.ts` drives detach through a `vi.fn` fake (never the
real `kit.remove(SignerKey.Policy(...))`), and the L1 backend verifier deliberately does **not** check
the `SignerLimits` shape. So a plausible future edit — making `verified_only` a co-signer inside
another key's `SignerLimits` map, as the verified-recipient doc-comment contemplates — would ship
**green** and re-introduce the V3 permanent-fund-lock (a reject-everything policy could then block its
own removal). No live bypass today; a test-coverage gap on a fund-lock-critical invariant.

> **Status (RA-6): OPEN.** Add an integration test that drives the real `connector-factory` attach
> and asserts the emitted signer is standalone `SignerLimits(None)`, and a detach test through the
> real `kit.remove` path — so the shape breaks a test if a refactor changes it.

### RA-7 — `isBlockedAddress` misses hex-form IPv4-mapped + NAT64 IPv6 ℹ️ Info `[my code]`

`services/worker-service/src/repo-url-guard.ts:64`.

As a pure unit, `isBlockedAddress` returns `false` for `::ffff:7f00:1` (127.0.0.1), `::ffff:a9fe:a9fe`
(169.254.169.254), and `64:ff9b::a9fe:a9fe` (NAT64) — the line-64 regex catches only the dotted
`::ffff:d.d.d.d` form. **Downgraded to Info** (from a claimed Low): no reachable failure today —
`new URL` keeps IPv6 literals bracketed, so `isIP` returns 0, the literal branch is skipped, and
`dns.lookup` of the bracketed string throws ENOTFOUND (fail-closed); the only production resolver
emits IPv4-mapped answers in the dotted form the regex does catch. Latent defense-in-depth: it
defends only a hypothetical future refactor that strips brackets before the literal check.

> **Status (RA-7): OPEN (latent).** Canonicalize IPv6 to bytes and range-check embedded IPv4-mapped
>
> - NAT64 rather than string-prefix matching. Low urgency; no live path.

### RA-8 — Audit hygiene: M3 / M4 / M5(deferral) / M8 / M9 are **not** code-fixed closures ℹ️ Info

Reporting risk, not a runtime defect. A reviewer tallying "closed by passing test" must not count
these: **M3** leak behavior is unchanged — the tests pin the _documented_ 2× tumbling-window property
(`spending-limit/src/test.rs:276` passes ~2× across a boundary); **M4** is product-gated + the V3
recovery path, no mainnet registry; **M5** is a boot-refusal guard only (`attestor-guard.ts`), **not**
a threshold attestor — a single `ATTESTOR_SECRET_KEY` compromise still forges provenance the moment
`ALLOW_SINGLE_KEY_ATTESTOR` is set; **M8** is a lockfile/override pin, no test; **M9** committed
`autoDeploy:false` + the `pnpm audit` gate, but branch-protection / Railway toggles remain manual
dashboard settings. Classify each as closed-by-doc / deferred / config-only, never closed-by-test.

> **Status (RA-8): informational.** No code change; ensures the closure ledger stays honest.

### RA-9 — Fixture-defect pattern: XDR-decoding tests built to match the code, not the kit ℹ️ Info → drives RA-1 `[my code]`

RA-1 is a **test-fixture failure as much as a code failure** — `scope.test.ts` built **V1**
credential fixtures, so the suite validated the V1-only bug instead of catching it. Auditing every
XDR-decoding assertion added in remediation for the same pattern (does the fixture match what
`passkey-kit@0.14.0` really produces, or what the implementation happens to parse?):

| Remediation                     | Fixture site                                                                                        | Verdict                                                | Kit-shape change that slips past                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FIX 2** derivation gate       | `derivation.test.ts:17` (pinned deployer, verified against the kit) + live `deriveWalletContractId` | **KIT-DERIVED (robust)**                               | none kit-shaped; a real seed/deployer drift breaks the pinned-pubkey assertion loudly                                                                                                                                                                                                                                                                                                                                                        |
| **FIX 1** `needsSponsorRebuild` | **no fixture at all** — `sponsor.test.ts` covers only `enforceFeeCap` / `consumeSponsorBudget`      | **UNTESTED**                                           | any change to the credential-type filter — nothing asserts on V2, the `sourceAccount` exclusion, or the one-op/invokeHostFunction/has-auth guards. (The filter is a _negative_ `!== sorobanCredentialsSourceAccount` check, so it accepts V2 correctly _today_ — safe by luck, not by test.)                                                                                                                                                 |
| **L1** attach-tx decode         | `verify-attach.test.ts:34-38` `buildAddPolicyXdr`                                                   | **CODE-SHAPED (same defect class as `scope.test.ts`)** | the helper builds a **3-element** `[Symbol('Policy'), Address, Void]` vec, but the kit's real `Signer::Policy` is a **5-element** tuple `[Symbol('Policy'), Address, Vec[Void], Vec[Void], Vec[Symbol('Persistent')]]`. It passes only because `collectAddresses` scans for the address _anywhere_ in the args and the function name is correct. A kit change to where the address is embedded breaks production while the test stays green. |

Three instances of the pattern (scope.test.ts + L1 + FIX-1's absence). Only FIX 2 builds its fixture
the way the kit actually produces the value.

> **Status (RA-9): CLOSED.** All three instances of the pattern closed:
>
> - **RA-1 (scope + tx-signer):** fixtures default to **V2** and parametrize v1/v2/delegates — a
>   V1-only regression fails (see RA-1).
> - **FIX-1 `needsSponsorRebuild`:** now has a test (`sponsor.test.ts`) — the predicate is exercised
>   with real V2/V1/delegates address credentials (→ route to sponsor), source-account and mixed
>   address+source (→ false), plus multi-op / empty-auth / non-invoke / unparseable guards. A
>   regression to a positive V1-only check now fails.
> - **L1 `buildAddPolicyXdr`:** rebuilt to the kit's **real 5-element** `Signer::Policy` tuple
>   `[Symbol('Policy'), Address, SignerExpiration::None, SignerLimits::None, SignerStorage::Persistent]`
>   (matching `passkey-kit` `buildPolicySigner` + the `passkey-kit-sdk` `Signer` UDT), replacing the
>   hand-built 3-element vec. A new assertion pins the tuple **arity** so a kit encoding drift is
>   visible; the decode path still finds the policy address in the realistic shape.
>
> `passkey-kit-sdk` is only a transitive dep here, so the fixtures reproduce the kit's on-the-wire
> shape element-for-element rather than importing the `Spec` directly; each is tied to the kit source
> lines it mirrors. Rule going forward: any test asserting on a decoded passkey-kit XDR shape must be
> built from (or pinned against) the real kit shape, never hand-fit to the parser.

### Re-audit bottom line

- **Closed by passing test (verified by reading assertions):** C1/H1/V2, V1 derivation gate, H2, H3,
  M2, M6-readiness, M7, L1, L3, L4, L5, L6/L6b.
- **Closed by doc/config/deferral (NOT code-fixed):** M3, M4, M5, M8, M9 (see RA-8).
- **Open / partial:** RA-1, RA-2 (funding-path Highs), RA-3 (M1), RA-4, RA-5, RA-6, RA-7.
- **Mainnet: NO-GO** until RA-1, RA-2, M1 are fixed+tested, plus the deferred prerequisites (M5
  multisig attestor, V3 detach UI) and the two V6 dashboard facts (L2 port firewalling, M9
  autoDeploy/branch-protection) are confirmed. Every verdict remains conditional on the **unaudited**
  `vellar-sdk` / `passkey-kit` (passkey ceremony, session store, address derivation this repo
  enforces against — and the V1→V2 credential upgrade that drives RA-1 lives in that unread kit).
