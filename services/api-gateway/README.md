# @vellar/api-gateway

Unified API entrypoint: auth/session middleware, rate limiting, request tracing, client routing.

## CORS Security Policy & Review Cadence

The API Gateway enforces strict origin verification at the boundary:

- **Allowed Origins**: Defaults strictly to known web clients (`http://localhost:3000`, `https://app.vellar.wallet`, `https://vellar.wallet`) and extension origins (`chrome-extension://vellar-wallet-extension`).
- **Dynamic Configuration**: Overridden via comma-separated `CORS_ORIGIN` environment variable.
- **Review Cadence**: CORS origin configurations must be audited quarterly or whenever new client domains or browser extension IDs are onboarded.
- **Disallowed Origins**: Any unlisted origin fails preflight checks and will not receive an `Access-Control-Allow-Origin` header.
