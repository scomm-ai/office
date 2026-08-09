# Billing JS module — Dart SDK reference

This package ports the using-party surface of [`billing_dart_sdk`](https://github.com/2keyapp/billing_dart_sdk)
(local reference: `D:\Code\2keyapp\billing_dart_sdk`) to TypeScript for Outlook / browser hosts.

| Dart | This package |
|------|----------------|
| `BillingSdk` | `BillingSdk` |
| `BillingAuthClient` | `BillingAuthClient` |
| `BillingSession` | `BillingSession` |
| `BillingApiClient` | `BillingApiClient` |
| `TokenVerifier` | `TokenVerifier` |

Do not vendor Dart sources here. Keep API names aligned so a future standalone JS SDK can extract this package cleanly.

See OpenSpec: `openspec/architecture/006-billing-auth-js.md`.
