# Vellar Documentation

Developer documentation for **Vellar** — a web-first Stellar smart wallet with a
companion browser extension. This folder is the source for the docs site; each
page is plain Markdown and renders as-is on GitHub or through any static docs
tool (Docusaurus, VitePress, MkDocs, …).

## Contents

| Page                                    | What it covers                                                              |
| --------------------------------------- | --------------------------------------------------------------------------- |
| [Overview](./overview.md)               | What Vellar is, its capabilities, and how the pieces fit together           |
| [Getting Started](./getting-started.md) | Prerequisites, install, running the full stack locally                      |
| [Architecture](./architecture.md)       | Monorepo layout, services, shared packages, contracts, data flow            |
| [API Reference](./api-reference.md)     | Every HTTP endpoint exposed through the API gateway                         |
| [Core Flows](./core-flows.md)           | Wallet creation, signing, policies, cleanup, extension pairing — end to end |
| [Security Model](./security-model.md)   | Passkeys, no-key-custody, origin permissions, no silent signing             |
| [Policy Contract](./policy-contract.md) | The configurable spending-limit Soroban contract                            |
| [x402 Agentic Payments](./x402.md)      | Paying HTTP-402 resources from a smart account under an on-chain budget      |

## Status

Vellar is under active development. Documentation describes what is **currently
implemented**; forward-looking features are marked as such. See each package's
own `README` for package-level detail.
