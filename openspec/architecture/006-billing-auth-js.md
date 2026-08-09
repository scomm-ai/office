# 006 — Billing Auth JS Module

## Status

**Accepted**

## Context

secMail uses `billing_dart_sdk` (Better Auth Flutter client + license JWT sync). SComm Office is TypeScript/React. The Dart SDK at `billing_dart_sdk` is the **API reference**; Office ports the surface to `@scomm-office/billing`, structured so it can later extract as a standalone JS SDK.

## Problem

Without a shared client module, Account/Billing UI and entitlement gates will diverge from secMail’s license model.

## Goals

- Mirror Dart SDK concerns: auth, session, license sync (ETag/304), ES256 verify, entitlements, plan catalog, portal URL helpers
- Use Better Auth **JS** client against `{billingOrigin}/api/auth`
- Call `{billingOrigin}/api/v1/license`, `/subscriptions/me`, `/plans`
- Work inside Outlook task-pane WebViews (popup/redirect OAuth; no Flutter deep links)

## Non-goals

- Hosting Better Auth or billing APIs inside Office
- Full portal/admin API (checkout, invoices, seats)
- Vendoring Dart source into the monorepo

## Constraints

- License verify PEM is public only; never embed private signing keys
- Dual identity: billing SSO ≠ mailbox identity ([constitution](../constitution.md))
- Cookie/session quirks in Office WebViews — document fallbacks (email/password, paste license token)

## Proposed design

Package: `packages/billing` → `@scomm-office/billing`

| Surface | Role |
|---------|------|
| `BillingSdk` | configure, sync, verify, `getPayload`, catalog |
| `BillingAuthClient` | Better Auth sign-in + `GET /api/auth/token` mint |
| `BillingSession` | persist auth/license, poll, offline paste |
| `BillingApiClient` | thin `/api/v1/*` HTTP |
| `TokenVerifier` | ES256 JWT → payload + entitlement helpers |

Reference: `packages/billing/REFERENCE.md` → Dart SDK path.

## Decision

**Implement `@scomm-office/billing` as the using-party JS client. Pin `better-auth` (npm or 2keyapp fork) to match the billing host.**

## Implementation status

| Item | Status |
|------|--------|
| Package scaffold | In progress |
| JWT verify + entitlements | In progress |
| Auth client + session | In progress |
| Add-in Account/Billing UI | In progress |
