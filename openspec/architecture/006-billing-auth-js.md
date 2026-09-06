# 006 — Billing Auth JS Module

## Status

**Accepted** (revised)

## Context

secMail uses `2key_dart_sdk`. Outlook is TypeScript/React. Both must be the **same using-party product**: DeviceID, signed license, catalog-gated entitlements.

`@2key/browser-sdk` (in `2key-billing-sdks`) is that JS client. This repo is a **host**, not an SDK.

## Problem

A local `@scomm-office/billing` port of Dart + Better Auth would drift from Flutter and duplicate JWT/entitlement math.

## Goals

- Pin `@2key/browser-sdk` for DeviceID, license restore/sync, and `hasProduct` / `hasOffering` / `hasAddon`
- Email/password + `acquireApiToken` via SDK HTTP adapters (no Better Auth types)
- Dual identity: mailbox (Office.js / MSAL) ≠ billing SSO
- Fail-closed gates against a static Outlook catalog intersected with the verified JWT

## Non-goals

- Hosting Better Auth or billing APIs inside Office
- Full portal/admin API (checkout, invoices, seats)
- Porting Dart into this monorepo
- Embedding DP / Rust AuthZ in the Outlook add-in

## Constraints

- License verify PEM is public only; never embed private signing keys
- Outlook WebViews: prefer email/password and paste-token; social OAuth via `displayDialogAsync` when needed
- Never send mail bodies or Graph tokens to billing
- Production add-in origin: `https://office.scomm.ai`

## Proposed design

Host wiring lives in `apps/outlook-addin/src/lib/billing-*.ts`.

```ts
const billing = createBillingClient({
  apiBaseUrl,
  publicKeyPem,
  storagePrefix: "scomm-office",
  catalog: SCOMM_OFFICE_CATALOG,
});
await billing.ensureDeviceId();
await billing.restore();
await billing.syncLicense({ accessToken });
billing.hasAddon("ai_assistant");
billing.hasAddon("pgp");
```

`@scomm-office/byoai` receives an `AddonGate` (`hasAddon` / `hasOffering`). It must not parse JWTs.

OpenPGP encrypt, sign, and key publish call `hasAddon("pgp")` (same SecMail SKU). Decrypt / verify stay ungated.

## Decision

**Delete `@scomm-office/billing`. The add-in consumes `@2key/browser-sdk` only.**

## Implementation status

| Item | Status |
|------|--------|
| Pin `@2key/browser-sdk` | Done |
| Account/Billing UI on DeviceID + sync + gates | Done |
| BYOAI `hasAddon("ai_assistant")` / `hasOffering` | Done |
| OpenPGP encrypt/sign/key publish `hasAddon("pgp")` | Done |
| Delete `@scomm-office/billing` | Done |
| CI forbid `better-auth` and local JWT parsers | Done |
