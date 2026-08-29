# @vellar/wallet-service

Wallet metadata, account preferences, session/device records, audit logs

## Health checks

| Route | Question it answers | External calls | On probe failure |
|---|---|---|---|
| `GET /health` | Is the process up, and (when a readiness probe is wired) can it serve dependent work? | DB ping, when wired | `503 { status: "unavailable" }` |
| `GET /ready` | Can this instance serve dependent work right now? | DB ping, when wired | `503 { status: "not_ready" }` |

Both routes are backed by the same readiness probe (`deps.isReady`, wired in
`src/index.ts` to `dbHandle.ping()` when Postgres is configured, or to the
in-memory-allowed policy check otherwise). `/health` predates `/ready` and is
kept exactly as it was — a dual liveness/readiness route — so an existing
deploy pointed at it (e.g. Render's `healthCheckPath`) doesn't change
behavior. `/ready` is the dedicated route for an orchestrator that wants a
clean liveness/readiness split: route new traffic here only when it returns
`200`, so a not-yet-connected-to-Postgres instance isn't sent live requests
during startup, and a degraded instance is taken out of rotation without
being restarted (a restart doesn't fix a database outage, and killing every
replica destroys the capacity needed to recover from one).
