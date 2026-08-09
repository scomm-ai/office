# `@scomm-office/server` — fixture only

This Fastify app is **not** part of the product topology for the client-only phase.

Product Outlook paths talk to:

- Billing host (Better Auth + `/api/v1/*`)
- Production pubkey read/write
- Third-party [idr.to](https://idr.to) via the browser SDK

Use this server only for local experiments (MVP `/api/v1/identities` pubkey mocks, health, etc.).

```bash
# Optional: run fixture alongside the add-in
pnpm --filter @scomm-office/server dev

# Or from repo root
pnpm dev:with-fixture-server
```

Default product `pnpm dev` starts the add-in + deb-console **without** this server.

See OpenSpec: [005-no-office-server](../../openspec/architecture/005-no-office-server.md), [constitution](../../openspec/constitution.md).
