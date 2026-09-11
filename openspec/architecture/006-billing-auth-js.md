# 006 — Billing Auth JS Module

## Status

**Accepted** (revised)

## Context

secMail uses `2key_dart_sdk`. Outlook is TypeScript/React. Both must be the **same using-party product**: DeviceID, signed license, catalog-gated entitlements.

`@2key/browser-sdk` (in `2key-billing-sdks`) is that JS client. This repo is a **host**, not an SDK.

## Problem

A local `@scomm-office/billing` port of Dart + Better Auth would drift from Flutter and duplicate JWT/entitlement math.

## Goals

- Pin `@2key/browser-sdk` for DeviceID, license restore/paste, and `normalizedEntitlements()` (`products.*.count`)
- Dual identity: mailbox (Office.js / MSAL) ≠ billing portal login
- Fail-closed gates against a static Outlook catalog intersected with the verified JWT
- No client `GET /api/v1/license` or in-add-in Better Auth for licensing

## Non-goals

- Hosting Better Auth or billing APIs inside Office
- Full portal/admin API (checkout, invoices, seats)
- Porting Dart into this monorepo
- Embedding DP / Rust AuthZ in the Outlook add-in

## Constraints

- License verify PEM is public only; never embed private signing keys
- Outlook WebViews: DeviceID copy → portal bind → paste signed license; restore cached snapshot on start
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
await billing.pasteLicense(snapshotFromPortal);
const snap = billing.normalizedEntitlements();
function featureCount(feature: string): number {
  let total = 0;
  for (const features of Object.values(snap.products)) {
    total += features[feature]?.count ?? 0;
  }
  return total;
}
const aiOk = featureCount("ai_assistant") >= 1;
const pgpOk = featureCount("pgp") >= 1;
```

Hosts should iterate `Object.values(snap.products)` rather than hard-code a tenant key. `@scomm-office/byoai` receives an `AddonGate` (`{ products }`). It must not parse JWTs.

OpenPGP encrypt, sign, and key publish require `pgp` `count >= 1` (Office-only SKU). Decrypt / verify stay ungated.

## Decision

**Delete `@scomm-office/billing`. The add-in consumes `@2key/browser-sdk` only.**

## Implementation status

| Item | Status |
|------|--------|
| Pin `@2key/browser-sdk` | Done |
| Account/Billing UI on DeviceID + paste + restore | Done |
| BYOAI `normalizedEntitlements().products.*.ai_assistant.count` | Done |
| OpenPGP encrypt/sign/key publish `pgp` count | Done |
| Delete `@scomm-office/billing` | Done |
| CI forbid `better-auth` and local JWT parsers | Done |
