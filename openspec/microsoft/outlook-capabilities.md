# Outlook Runtime Capability Registry

## Status

**Accepted**

## Context

Outlook add-ins run across heterogeneous hosts: Outlook on the web, new Outlook for Windows, classic Outlook for Windows, Outlook for Mac, and limited mobile support. Feature availability depends on **requirement sets**, host application, and platform — not on browser user-agent strings.

SComm Office gates every Outlook-dependent feature behind runtime detection.

## Problem

Hard-coding feature availability by platform name or UA sniffing produces false positives (features appear enabled but fail at runtime) and false negatives (features disabled on capable hosts). Microsoft explicitly recommends requirement-set detection.

## Goals

- Central **`OutlookCapabilities`** registry populated at add-in startup
- Every feature checks capabilities before invoking Office.js APIs
- Diagnostics panel exposes all capability flags to users and support
- Pure functions testable without Outlook (`detectCapabilitiesFromOffice()` vs mock)

## Non-goals

- Detecting Outlook version for feature marketing
- UA-based platform identification
- Claiming support for untested platform combinations

## Constraints

- `Office.context.requirements.isSetSupported(setName, minVersion)` is the authoritative API
- Some APIs require both requirement set AND host check (e.g. mobile excludes certain events)
- WebRTC/WebCrypto are browser APIs, not Office requirement sets — probed separately for IDR

## Proposed design

### Capability interface

```typescript
interface OutlookCapabilities {
  mailboxRequirementSet: string;  // highest supported, e.g. "1.14"

  // Mailbox features
  internetHeaders: boolean;       // Mailbox 1.8+
  eventBasedActivation: boolean;  // manifest + host support
  onMessageCompose: boolean;
  onMessageSend: boolean;         // Mailbox 1.12+
  smartAlerts: boolean;           // OnMessageSend + allow/warn/block
  onMessageDecrypt: boolean;      // event + header (experimental)
  attachments: boolean;
  signatureApi: boolean;

  // Identity
  nestedAppAuthentication: boolean;  // NestedAppAuth 1.1

  // Browser (for IDR)
  webRtc: boolean;
  webCryptoEd25519: boolean;
}
```

### Detection algorithm

```typescript
function detectOutlookCapabilities(office: typeof Office): OutlookCapabilities {
  const isSet = (set: string, ver: string) =>
    office.context.requirements.isSetSupported(set, ver);

  const mailboxVer = highestSupportedMailboxVersion(office);

  return {
    mailboxRequirementSet: mailboxVer,
    internetHeaders: isSet("Mailbox", "1.8"),
    onMessageSend: isSet("Mailbox", "1.12"),
    smartAlerts: isSet("Mailbox", "1.12"), // + manifest LaunchEvent
    nestedAppAuthentication: isSet("NestedAppAuth", "1.1"),
    webRtc: typeof RTCPeerConnection !== "undefined",
    webCryptoEd25519: await probeEd25519(),
    // ...
  };
}
```

**Never:**

```typescript
// FORBIDDEN
if (navigator.userAgent.includes("Outlook")) { ... }
```

### Feature gating pattern

```typescript
if (!capabilities.onMessageSend) {
  disableSendHandlerUI();
  return;
}
```

UI shows explicit "Not supported on this Outlook client" rather than silent failure.

### Diagnostics module

Task pane → Diagnostics displays:

| Flag | Source |
|------|--------|
| Mailbox requirement set | `isSetSupported` scan |
| Internet headers | Mailbox ≥ 1.8 |
| OnMessageSend | Mailbox ≥ 1.12 + manifest |
| NAA | NestedAppAuth 1.1 |
| WebRTC | `RTCPeerConnection` probe |
| WebCrypto Ed25519 | keygen probe |

## Alternatives

| Alternative | Why rejected |
|-------------|--------------|
| UA sniffing | Unreliable; breaks on new hosts |
| Try/catch without pre-check | Poor UX; spurious errors in telemetry |
| Compile-time `#ifdef` style | Same bundle serves all platforms |

## Security considerations

- Capability flags are not a security boundary — they gate UX only
- Do not expose capability bypass for "power users"
- Failed API calls still handled with typed errors

## Compatibility

See [requirement-sets](./requirement-sets.md) for platform matrix.
WebRTC: [webrtc-host-support](./webrtc-host-support.md) — Under Investigation.

## Open questions

- Exact mapping of `smartAlerts` to Mailbox 1.14 `SendModeOverride`
- Whether to cache capability results for session or re-probe on item switch

## Decision

**Runtime detection via `Office.context.requirements.isSetSupported` plus browser API probes. No UA sniffing. All features disable cleanly when unsupported.**

## Implementation status

| Item | Status |
|------|--------|
| `OutlookCapabilities` type | Planned |
| `detectOutlookCapabilities()` | Planned (Milestone 2) |
| Diagnostics UI | Planned |
| Unit tests with mock Office | Planned |

## Deferred work

- Automatic capability change detection on host updates
- Telemetry of capability distributions (privacy-preserving)
