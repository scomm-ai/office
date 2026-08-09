# 001 — Monorepo Layout

## Status

**Accepted**

## Context

SComm Office ships as a single product comprising:

1. An Outlook Office.js add-in (React + Vite task pane)
2. A Fastify backend server (Node.js ≥ 24)
3. Shared TypeScript libraries consumed by both

The repository is greenfield (`scomm-office` on GitHub). Early scaffolding includes `@scomm-office/core` with email normalization, typed errors, and UID helpers.

## Problem

Without a disciplined monorepo layout, Office.js calls leak into semantic parsing, API contracts diverge between client and server, and Outlook-specific code becomes untestable outside the host.

## Goals

- One `pnpm` workspace with strict TypeScript, ESLint, Prettier, and Vitest
- Clear separation: **apps** (runnable) vs **packages** (libraries)
- Shared contracts via `@scomm-office/protocol` (Zod schemas)
- `@scomm-office/*` npm scope for all internal packages
- `pnpm dev` starts add-in + server + optional dev-console in parallel

## Non-goals

- Publishing packages to npm (all `private: true` for MVP)
- Nx/Turborepo orchestration (plain pnpm filters suffice)
- Multi-language components (TypeScript only)
- Docker-first development (local Node + sideloaded add-in)

## Constraints

- Node.js ≥ 24 (`engines` in root `package.json`)
- pnpm 9.x (`packageManager: pnpm@9.15.0`)
- ESM throughout (`"type": "module"`)
- PostgreSQL available at `localhost:5433` for future persistence; MVP uses in-memory repositories

## Proposed design

### Workspace layout

```text
scomm-office/
├── apps/
│   ├── outlook-addin/     # Vite + React task pane, manifest, event handlers
│   ├── server/            # Fastify: health, config, pubkeys mock, stubs
│   └── dev-console/       # Fixture loader for semantics/policy debugging
├── packages/
│   ├── core/              # errors, result, UID, email normalization
│   ├── office/            # MailHost, OutlookMailHost, MockMailHost, capabilities
│   ├── semantics/         # typed segments, heuristic pipeline, digest
│   ├── identity/          # identity models, KeyTrust states
│   ├── pubkeys/           # PublicKeyDirectory clients
│   ├── idr/               # IdrTransport → IdrBrowserTransport
│   ├── crypto/            # encrypt/decrypt interfaces (stubs)
│   ├── microsoft-graph/   # Graph client interfaces
│   ├── policy/            # PolicyEngine
│   ├── protocol/          # Zod DTOs, X-SComm header constants
│   ├── storage/           # settings / key-store interfaces
│   ├── observability/     # audit types, structured logging hooks
│   ├── testkit/           # HTML/.eml fixtures
│   └── config/            # EffectiveConfiguration resolution
├── openspec/              # this documentation tree
├── docs/
├── scripts/
├── .github/workflows/ci.yml
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

### Package scope

All internal packages use `@scomm-office/<name>`:

| Package | Responsibility |
|---------|----------------|
| `@scomm-office/core` | Cross-cutting primitives |
| `@scomm-office/office` | Outlook / MailHost boundary |
| `@scomm-office/semantics` | Semantic engine (Office.js-free) |
| `@scomm-office/protocol` | Shared wire formats |
| `@scomm-office/idr` | IDR browser SDK wrapper |
| `@scomm-office/pubkeys` | Public key directory clients |
| `@scomm-office/policy` | Compliance rule evaluation |
| `@scomm-office/microsoft-graph` | Graph adapter |
| `@scomm-office/crypto` | E2EE interfaces (experimental) |

Apps depend on packages; packages must not depend on apps. Dependency direction flows inward: `apps → packages → core`.

### Root scripts

| Script | Behavior |
|--------|----------|
| `pnpm dev` | Parallel dev for server, outlook-addin, dev-console |
| `pnpm build` | Recursive build all packages and apps |
| `pnpm test` | Recursive unit tests |
| `pnpm typecheck` | Recursive `tsc --noEmit` |
| `pnpm lint` | ESLint with zero warnings |

### TypeScript project references

Each package extends `tsconfig.base.json` with:

- `"composite": true`
- `"strict": true`
- `"rootDir": "src"`, `"outDir": "dist"`

## Alternatives

| Alternative | Why rejected |
|-------------|--------------|
| npm workspaces | pnpm preferred for disk efficiency and strict dependency hoisting |
| Single-package repo | Cannot share contracts cleanly between add-in and server |
| Lerna/Nx | Overhead unjustified for initial team size |
| Yarn Berry | Team standard is pnpm |

## Security considerations

- No secrets in committed config; env vars for Entra app IDs, dev tokens
- Add-in bundle is fully inspectable — never embed client secrets
- CI runs lint, typecheck, test, build on every push

## Compatibility

- Windows, macOS, Linux dev environments
- Outlook sideloading requires HTTPS dev certs (documented in README)
- Server binds to configurable port; add-in Vite dev server on separate port

## Open questions

- When to introduce PostgreSQL-backed repositories vs in-memory (MVP stays in-memory)
- Whether to add Playwright to CI immediately or after first UI milestone
- Unified manifest vs add-in-only XML for Outlook LaunchEvent support

## Decision

**Lock MVP on pnpm workspaces with `@scomm-office/*` scope, apps under `apps/`, libraries under `packages/`, Fastify server, Vite+React add-in, Vitest for unit tests, and in-memory persistence until Postgres integration is specified.**

Add-in manifest: **add-in-only XML** (`manifest.xml`) for reliable LaunchEvent sideloading in MVP.

## Implementation status

| Item | Status |
|------|--------|
| Root `package.json`, `pnpm-workspace.yaml` | Done |
| `@scomm-office/core` | Partial (errors, email, uid) |
| Remaining packages / apps | Planned (Milestone 1–10) |
| CI workflow | Done (lint, typecheck, test, build) |

## Deferred work

- PostgreSQL repository implementations ([server persistence](../deferred/README.md))
- Unified manifest migration
- Playwright E2E in CI
- npm publishing of any `@scomm-office/*` package
