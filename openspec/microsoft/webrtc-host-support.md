# WebRTC Host Support in Outlook

## Status

**Under Investigation**

## Context

The IDR browser SDK (`@idrto/idr_browser_sdk`) depends on **WebRTC** (`RTCPeerConnection`, data channels) and **WebCrypto Ed25519** for default connectivity to idr.to targets. Outlook add-ins run inside host-controlled WebViews whose WebRTC support is not documented by Microsoft for add-in scenarios.

## Problem

SComm Office cannot claim IDR/BYOM connectivity works on all Outlook platforms without empirical testing. False claims would mislead users deploying BYOM in enterprise Outlook environments where WebRTC may be blocked.

## Goals

- Document **untested** platform matrix honestly
- Detect WebRTC/WebCrypto at runtime and surface status in Diagnostics
- Support SDK `transport: "https"` relay fallback where WebRTC fails
- Track test results as they become available

## Non-goals

- Guaranteeing WebRTC on any Outlook host in MVP
- Implementing custom TURN/STUN infrastructure
- Bypassing enterprise WebRTC blocks

## Constraints

- Outlook hosts use Edge WebView2 (Windows), WKWebView (Mac), or browser (OWA) — WebRTC support varies
- Enterprise policies may disable WebRTC or UDP
- IDR SDK falls back to HTTPS relay at `https://*.idr.to` when `transport: "auto"` and WebRTC fails
- Testing requires physical/virtual devices with Outlook installed and sideloaded add-in

## Proposed design

### Runtime detection

```typescript
function detectWebRtcSupport(): "supported" | "unsupported" | "blocked" {
  if (typeof RTCPeerConnection === "undefined") return "unsupported";
  // Optional: lightweight data channel probe
  return "supported";
}

async function detectWebCryptoEd25519(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign"]);
    return true;
  } catch {
    return false;
  }
}
```

Diagnostics states:

| State | Meaning |
|-------|---------|
| Supported | APIs present; IDR connection test may proceed |
| Unsupported | APIs missing — IDR disabled unless HTTPS-only path verified |
| Blocked | APIs present but connection test failed (policy/network) |
| Authentication required | IDR session not established |
| Connection failed | Last connect attempt failed |

### Platform test matrix

**All entries below are UNTESTED as of this document.** Do not ship user-facing "supported" language until verified.

| Platform | WebRTC expected? | WebCrypto Ed25519 expected? | IDR connect tested? | Notes |
|----------|------------------|----------------------------|----------------------|-------|
| Outlook Web (Chrome/Edge) | Unknown | Likely yes | **No** | Browser-native WebRTC |
| Outlook Web (Safari) | Unknown | Likely yes (17.4+) | **No** | |
| New Outlook for Windows | Unknown | Likely yes (WebView2) | **No** | Chromium-based |
| Classic Outlook for Windows | Unknown | Unknown | **No** | WebView2 add-in runtime |
| Outlook for Mac | Unknown | Likely yes (recent) | **No** | WKWebView |
| Outlook iOS | Unknown | Unknown | **No** | Mobile task pane limited |
| Outlook Android | Unknown | Unknown | **No** | Mobile task pane limited |

### Fallback path

When WebRTC unsupported or blocked:

```typescript
await transport.connect(target, { transport: "https" });
```

Requires CSP `connect-src https://*.idr.to`. Higher latency; may not support streaming.

### User messaging

Task pane IDR section when unsupported:

> ID-Based Routing requires WebRTC or HTTPS relay. This Outlook client has not been verified. Run connection test or use Settings → Diagnostics.

**Do not display "Supported on Outlook Windows" or similar until tested.**

## Alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Assume OWA works | Untested; enterprise CSP may differ |
| Server-side IDR proxy | Violates BYOM privacy model |
| Disable IDR entirely in Outlook | Removes core MVP POC value |

## Security considerations

- WebRTC exposes local IP candidates (STUN) — document in [privacy](../security/privacy.md)
- HTTPS relay still terminates at idr.to infrastructure — user must trust IDR path
- Failed probes should not leak internal network details in UI

## Compatibility

- IDR features disable when both WebRTC and HTTPS relay fail
- Dev-console and MockIdrTransport unaffected

## Open questions

- Does New Outlook WebView2 expose full WebRTC to add-in iframes?
- Classic Outlook COM add-in vs Web add-in runtime differences
- Mobile Outlook WebView WebRTC availability (likely none)

## Decision

**Do not claim WebRTC/IDR support on any Outlook platform until manually verified.** Runtime detection + connection test required. Status remains **Under Investigation**. MVP ships IDR integration with explicit diagnostics and HTTPS fallback option.

## Implementation status

| Item | Status |
|------|--------|
| Runtime WebRTC/WebCrypto probes | Planned |
| Connection test UI | Planned |
| Platform test results | **None recorded** |
| Documentation honesty | This document |

## Deferred work

- Formal QA matrix execution and result updates to this doc
- Automated Outlook-hosted E2E (may require special harness)
- Enterprise WebRTC policy guidance for IT admins
