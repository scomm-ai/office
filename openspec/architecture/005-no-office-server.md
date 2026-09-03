# 005 — No Product Office Server (Client-Only Phase)

## Status

**Accepted**

## Context

Early scaffolding included a Fastify `apps/server` for health, config, and an MVP pubkey directory. The product direction is now **client-only**: the Outlook add-in talks to external ecosystem services. See [constitution](../constitution.md).

## Problem

Shipping a product Office backend before it is required creates auth duplication, a second pubkey contract, and maintenance load while secMail already depends on billing + pubkey hosts.

## Goals

- Product add-in config points at billing origin, pubkey read/write bases, and IDR (browser SDK) only
- `apps/server` is optional fixture for local experiments / unit mocks
- Document how to reintroduce an Office server later without breaking clients

## Non-goals

- Deleting `apps/server` from the monorepo in this phase
- Replacing the production billing or pubkey backends
- Server-side IDR proxy

## Constraints

- Add-in WebView must call external HTTPS origins allowed by CSP / Office host policy
- No long-lived Office-server session; billing uses `@2key/browser-sdk` (DeviceID + license JWT)

## Proposed design

```text
Outlook add-in (product)
  → billing host (/api/auth, /api/v1/*)
  → pubkey read/write (production)
  → idr.to (embedded @idrto/idr_browser_sdk)
  → cloud LLM APIs (user BYOAI keys, browser-origin)

apps/server (fixture only)
  → optional local mocks; not default VITE_* targets
```

## Decision

**Product paths do not require `apps/server`. Keep Fastify as a fixture; mark Office product API server deferred until a later phase.**

## Implementation status

| Item | Status |
|------|--------|
| Constitution principle | Done |
| Add-in env defaults away from local server | In progress |
| Fixture README for `apps/server` | In progress |
