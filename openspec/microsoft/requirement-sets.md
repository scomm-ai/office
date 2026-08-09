# Outlook Requirement Sets

## Status

**Accepted**

## Context

Microsoft Office Add-ins declare and detect **requirement sets** — versioned API groups. SComm Office depends on specific Mailbox and Identity sets for headers, send interception, and Graph authentication.

Official reference: [Outlook JavaScript API requirement sets](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/outlook/outlook-api-requirement-sets).

## Problem

Using APIs without verifying the requirement set causes runtime failures that vary by Outlook client. SComm features (header stamping, Smart Alerts, NAA) each map to specific minimum sets.

## Goals

- Document minimum requirement sets for each SComm feature
- Encode minimums in manifest `<Requirements>` and runtime checks
- Provide platform availability guidance (without false guarantees)

## Non-goals

- Supporting hosts below Mailbox 1.5 (baseline task pane)
- Guaranteeing feature parity across all Outlook clients

## Constraints

- Manifest `<Requirements>` sets minimum for installation; runtime may still differ slightly by build
- Mobile Outlook has significant exclusions (no LaunchEvent on mobile as of current docs)
- Outlook.com consumer and Gmail-connector hosts have limited add-in support

## Proposed design

### SComm feature → requirement mapping

| SComm feature | Requirement set | Minimum version |
|---------------|-----------------|-----------------|
| Task pane (read/compose) | Mailbox | 1.5 |
| Internet headers read/write | Mailbox | **1.8** |
| Event-based activation (LaunchEvent) | Mailbox | 1.10+ (varies by event) |
| `OnMessageCompose` | Mailbox | 1.10 |
| `OnMessageSend` / Smart Alerts | Mailbox | **1.12** |
| Send mode override (soft block) | Mailbox | 1.14 |
| Nested App Authentication (NAA) | NestedAppAuth | **1.1** |
| `OnMessageDecrypt` | Mailbox | 1.14+ (preview/experimental) |

### Internet headers (Mailbox 1.8)

Required for `X-SComm-*` metadata:

```typescript
Office.context.mailbox.item.internetHeaders.getAsync(...)
Office.context.mailbox.item.internetHeaders.setAsync(...)
```

**Platform notes (Microsoft documentation, subject to change):**

- Supported: Outlook on the web, new Outlook Windows, classic Outlook Windows (recent builds), Outlook Mac (recent builds)
- Not supported: Some mobile clients

### OnMessageSend / Smart Alerts (Mailbox 1.12)

LaunchEvent handler runs before send completes. Can return:

- `allow` — proceed
- `promptUser` — warn with optional block
- `block` — prevent send (where supported)

**Not available on Outlook mobile.**

Handler must complete quickly; no long network calls.

### Nested App Authentication (NestedAppAuth 1.1)

Enables MSAL acquireToken without pop-up in supported hosts. Required for seamless Graph access from task pane.

**Known limitations:**

- Not supported on Outlook.com free accounts in all configurations
- Not supported on Gmail-connected Outlook
- Requires Entra app registration with correct redirect URIs
- Admin consent may be required for org-wide deployment

See [graph-authentication](./graph-authentication.md).

### Platform matrix (guidance)

| Platform | Task pane | Headers 1.8 | OnMessageSend 1.12 | NAA 1.1 | Notes |
|----------|-----------|-------------|---------------------|---------|-------|
| Outlook Web | Yes | Yes | Yes | Yes* | *Entra config dependent |
| New Outlook Windows | Yes | Yes | Yes | Yes* | WebView2-based |
| Classic Outlook Windows | Yes | Yes** | Yes** | Varies | **Recent M365 builds |
| Outlook Mac | Yes | Yes** | Yes** | Varies | |
| Outlook iOS | Limited | No | No | No | Task pane only |
| Outlook Android | Limited | No | No | No | Task pane only |

*Verify with runtime detection, not assumptions.

### Manifest declaration

```xml
<Requirements>
  <Sets DefaultMinVersion="1.5">
    <Set Name="Mailbox" MinVersion="1.8"/>
    <Set Name="NestedAppAuth" MinVersion="1.1"/>
  </Sets>
</Requirements>
```

LaunchEvent for send requires additional manifest extension (see [event-based-activation](./event-based-activation.md)).

## Alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Target only Outlook Web | Excludes desktop users |
| Require Mailbox 1.14 globally | Excludes too many enterprise clients |

## Security considerations

- Lower requirement sets mean fewer enforcement hooks — policy becomes advisory-only
- NAA failure must not fall back to insecure token passthrough

## Compatibility

Runtime registry ([outlook-capabilities](./outlook-capabilities.md)) reflects actual host, not this static matrix.

## Open questions

- Unified manifest requirement set declaration vs add-in-only XML
- Exact build numbers for classic Outlook header support in enterprise deferred channels

## Decision

**Manifest declares Mailbox 1.8 + NestedAppAuth 1.1 minimum. Runtime gates OnMessageSend on Mailbox 1.12. Mobile treated as read-only/task-pane-only for SComm metadata write and send hooks.**

## Implementation status

| Item | Status |
|------|--------|
| Manifest Requirements | Planned |
| Runtime mapping | Planned |
| Platform matrix in docs | This document |

## Deferred work

- Unified manifest migration
- OnMessageDecrypt requirement verification
