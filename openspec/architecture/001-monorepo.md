# 001 — Monorepo Layout

## Status

**Accepted**

## Context

SComm Office ships as a **client-first** product:

1. An Outlook Office.js add-in (React + Vite task pane) — primary product surface
2. Shared TypeScript libraries (`@scomm-office/*`)
3. Optional `apps/server` Fastify **fixture** (not product wiring) — see [005-no-office-server](./005-no-office-server.md)
4. Optional `apps/dev-console` for fixture runs outside Outlook

Standing goal: bring SComm (secMail) capabilities into Office hosts starting with Outlook ([constitution](../constitution.md)).

## Problem

Without a disciplined monorepo layout, Office.js calls leak into semantic parsing, wire contracts diverge, and Outlook-specific code becomes untestable outside the host.

## Goals

- One `pnpm` workspace with strict TypeScript, ESLint, Prettier, and Vitest
- Clear separation: **apps** (runnable) vs **packages** (libraries)
- Shared contracts via `@scomm-office/protocol` (Zod schemas)
- `@scomm-office/*` npm scope for all internal packages
- Product deps: billing host, pubkey hosts, IDR browser SDK — not a local Office API

## Non-goals

- Publishing packages to npm (all `private: true` for MVP)
- Nx/Turborepo orchestration
- Multi-language components (TypeScript only for Office; Dart SDK is reference only)
- Docker-first development

## Constraints

- Node.js ≥ 24
- pnpm 9.x
- ESM throughout
- Product add-in must not require Postgres / local Fastify

## Proposed design

### Workspace layout

```text
scomm-office/
├── apps/
│   ├── outlook-addin/     # Vite + React task pane (product)
│   ├── server/            # Fastify fixture only
│   └── dev-console/       # Fixture loader
├── packages/
│   ├── core/
│   ├── office/
│   ├── semantics/
│   ├── identity/
│   ├── pubkeys/           # Production pubkey client + mocks
│   ├── byoai/             # Local (IDR) + Cloud BYOAI
│   ├── idr/               # Third-party IDR embed
│   ├── crypto/
│   ├── microsoft-graph/
│   ├── policy/
│   ├── protocol/
│   ├── storage/
│   ├── observability/
│   ├── testkit/
│   └── config/
├── openspec/
├── docs/
└── …
```

### Package scope

| Package | Responsibility |
|---------|----------------|
| `@scomm-office/core` | Cross-cutting primitives |
| `@scomm-office/office` | Outlook / MailHost boundary |
| `@scomm-office/byoai` | Local + Cloud AI providers |
| `@scomm-office/idr` | IDR browser SDK wrapper |
| `@scomm-office/pubkeys` | Public key directory clients |
| `@scomm-office/semantics` | Semantic engine |
| `@scomm-office/protocol` | Shared wire formats |

Apps depend on packages; packages must not depend on apps.

### Root scripts

| Script | Behavior |
|--------|----------|
| `pnpm dev` | Parallel add-in + optional fixture server + dev-console |
| `pnpm build` / `test` / `typecheck` / `lint` | Recursive |

## Decision

**Lock on pnpm workspaces with `@scomm-office/*`, client-first product topology, Fastify as fixture only.**

## Implementation status

| Item | Status |
|------|--------|
| Root workspace | Done |
| Billing via `@2key/browser-sdk` + BYOAI | Done |
| CI | Done |

## Deferred work

- Product Office API server ([005](./005-no-office-server.md), [deferred](../deferred/README.md))
- npm publishing of `@2key/browser-sdk` (until then, pin the sibling workspace)
- Playwright E2E in CI
