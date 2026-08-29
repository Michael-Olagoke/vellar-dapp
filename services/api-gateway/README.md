# @vellar/api-gateway

Unified API entrypoint: CORS, rate limiting, security headers, body-size cap, CSRF mitigation, and reverse-proxy routing to downstream services.

---

## Architecture

The gateway is a single Fastify server. Every incoming request passes through a shared `onRequest` hook that enforces:

- **Body-size cap** (413) — checked on `Content-Length` before the body is streamed upstream.
- **Content-type enforcement** (415) — mutations (POST/PUT/PATCH) must send `application/json` (CSRF mitigation for a cookieless API).

Global plugins applied to all routes:

| Plugin | Purpose |
|---|---|
| `@fastify/helmet` | Security headers (HSTS, X-Frame-Options, nosniff, …) |
| `@fastify/cors` | Restricts browser callers to the configured origin(s) |
| `@fastify/rate-limit` | Per-IP request cap; `/health` is exempt |

---

## Route registration — `registerProxyRoute`

Every downstream service is proxied with the same three-field pattern (upstream URL, gateway prefix, rewrite prefix). Rather than repeating `app.register(proxy, { upstream, prefix, rewritePrefix })` for every route, use the shared helper:

```ts
import { registerProxyRoute } from "./register-proxy-route";

registerProxyRoute(app, {
  upstream: walletServiceUrl, // e.g. "http://localhost:4001"
  prefix: "/wallet",          // path the gateway exposes
  // rewritePrefix defaults to prefix — omit when they are the same
});
```

### Options

| Field | Type | Required | Description |
|---|---|---|---|
| `upstream` | `string` | yes | Base URL of the backend service |
| `prefix` | `string` | yes | Path prefix exposed by the gateway |
| `rewritePrefix` | `string` | no | Path forwarded to the upstream (defaults to `prefix`) |

When the gateway prefix and the upstream path differ — for example a future versioned route (`/v2/wallet` → `/wallet`) — pass `rewritePrefix` explicitly:

```ts
registerProxyRoute(app, {
  upstream: walletServiceUrl,
  prefix: "/v2/wallet",
  rewritePrefix: "/wallet",
});
```

### Current routes

| Gateway prefix | Upstream env var | Default upstream URL |
|---|---|---|
| `/wallet` | `WALLET_SERVICE_URL` | `http://localhost:4001` |
| `/lifecycle` | `LIFECYCLE_SERVICE_URL` | `http://localhost:4002` |
| `/policies` | `POLICY_SERVICE_URL` | `http://localhost:4003` |
| `/verification` | `VERIFICATION_SERVICE_URL` | `http://localhost:4004` |

---

## Configuration

All values can be set via environment variables or passed directly to `buildServer(options)` (useful in tests):

| Env var | Default | Description |
|---|---|---|
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed browser origin(s), comma-separated |
| `RATE_LIMIT_MAX` | `120` | Max requests per IP per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window in ms |
| `MAX_BODY_BYTES` | `1048576` (1 MiB) | Maximum request body size |
| `REQUEST_TIMEOUT_MS` | `30000` | Connection-level timeout |
| `PORT` | `4000` | Port the gateway listens on |
