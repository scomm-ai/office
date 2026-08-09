# 003 — IDR Transport Layer

## Status

**Accepted**

## Context

SComm Office connects user-controlled AI and agent services via **ID-Based Routing** through [idr.to](https://idr.to). The [`@idrto/idr_browser_sdk`](https://github.com/idrto/idr_browser_sdk) (v1.0.0) provides browser-native connectivity using WebRTC DataChannels, WebCrypto Ed25519, Signed Host Identity, and signaling at `wss://idr.to/v1/signal`.

SComm Office must not reimplement IDR signaling, tunnel multiplexing (`idr-tunnel-v1`), or Ed25519 identity logic.

## Problem

Raw SDK usage scattered across UI components creates:

- Tight coupling to `IdrClient` lifecycle and error codes
- CSP misconfiguration blocking signaling or HTTPS relay
- Untestable AI/IDR features
- Accidental exposure of SDK internals to React components

## Goals

- Wrap SDK behind **`IdrTransport`** application interface
- Map SDK errors to `IdrConnectionError` (from `@scomm-office/core`)
- Expose connection/auth states for diagnostics UI
- Support BYOM/BYOAI proof-of-concept: connect → `fetch("/api/tags")` on Ollama-compatible targets
- Document required CSP entries for Outlook add-in manifest

## Non-goals

- Reimplementing IDR protocol or signaling
- Server-side IDR proxy (browser-origin only for MVP)
- Automatic IDR connections triggered by email content
- TUN/TCP socket access

## Constraints

- SDK hardcodes `IDR_API_BASE = "https://idr.to"` and `IDR_SIGNAL_URL = "wss://idr.to/v1/signal"`
- WebCrypto Ed25519 required (Chrome 113+, Safari 17.4+, Firefox 130+)
- WebRTC required for default transport; HTTPS relay fallback uses `https://*.idr.to`
- Credentials stored in `localStorage` / `sessionStorage` by SDK — subject to Outlook WebView storage partitioning
- Auth UI requires mountable `HTMLElement`; passwords must stay in SDK panel
- Service name (e.g. `"ollama"`) is ISV-configured via `IdrClient.forService(service)`

## Proposed design

### IdrTransport interface

```typescript
export interface IdrTransport {
  authenticate(options?: IdrAuthOptions): Promise<void>;
  connect(target: IdrTarget, options?: IdrConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  fetch(request: IdrRequest): Promise<IdrResponse>;
  getState(): IdrConnectionState;
  isAuthenticated(): boolean;
}

export interface IdrTarget {
  host: string;    // e.g. "edge-gpu-1.user@example.com.idr"
  service: string; // e.g. "ollama", "scomm-ai"
}

export type IdrConnectionState =
  | "idle"
  | "authenticating"
  | "connecting"
  | "connected"
  | "failed"
  | "unsupported";  // WebRTC/WebCrypto unavailable
```

### IdrBrowserTransport implementation

```typescript
// packages/idr/src/IdrBrowserTransport.ts
import { IdrClient } from "@idrto/idr_browser_sdk";
import { mountAuthPanel } from "@idrto/idr_browser_sdk/auth";

export class IdrBrowserTransport implements IdrTransport {
  private client: IdrClient;

  constructor(service: string) {
    this.client = IdrClient.forService(service);
  }

  async authenticate(opts?: IdrAuthOptions): Promise<void> {
    await this.client.ensureSession({
      interactive: opts?.interactive ?? true,
      mount: opts?.mount,
    });
  }

  async connect(target: IdrTarget, opts?: IdrConnectOptions): Promise<void> {
    await this.client.connect({
      host: target.host,
      transport: opts?.transport ?? "auto",
      signal: opts?.signal,
      timeoutMs: opts?.timeoutMs ?? 60_000,
    });
  }

  async fetch(request: IdrRequest): Promise<IdrResponse> {
    return this.client.fetch(request.path, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
    });
  }
  // ...
}
```

### AiProvider abstraction (above IdrTransport)

```typescript
interface AiProvider {
  generate(request: AiGenerateRequest): Promise<AiGenerateResponse>;
}

// MVP POC only:
class OllamaViaIdrProvider implements AiProvider {
  constructor(private transport: IdrTransport) {}
  async listModels(): Promise<string[]> {
    const res = await this.transport.fetch({ path: "/api/tags", method: "GET" });
    // parse Ollama response
  }
}
```

UI and semantics never import `@idrto/idr_browser_sdk` directly.

### Capability detection

Before IDR initialization:

1. `typeof RTCPeerConnection !== "undefined"`
2. WebCrypto Ed25519 key generation probe
3. Surface `unsupported` state in diagnostics if either fails

Transport fallback: SDK `transport: "https"` uses DEF relay at `https://{hash}.idr.to/{service}/…`

### Content Security Policy

Production add-in CSP must include (minimum):

```text
connect-src
  https://idr.to
  wss://idr.to
  https://*.idr.to
  https://login.microsoftonline.com
  https://graph.microsoft.com
  'self'
  [SComm server origin]
  [Pubkey server origin]
```

Development variant may add `https://localhost:*` for local server.

**Do not use `connect-src *` in production.**

Also allow Microsoft Office CDN for scripts/styles per standard add-in guidance.

### Settings UI

Settings → ID-Based Routing:

| Field | Purpose |
|-------|---------|
| IDR target host | User's `.idr` hostname |
| Default service | e.g. `ollama`, `scomm-ai` |
| Auth status | From `isAuthenticated()` |
| Connection status | From `getState()` |

IDR destinations come from **user/org configuration only** — never from email body links.

## Alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Direct `IdrClient` in React | Untestable; leaks SDK lifecycle |
| Server-side IDR proxy | Violates BYOM privacy model; adds credential handling burden |
| Custom WebRTC stack | Duplicates maintained SDK |

## Security considerations

- Email must not trigger automatic IDR connections ([ai-trust-boundary](../security/ai-trust-boundary.md))
- `idrto:` URIs in message bodies treated as untrusted links
- SDK credentials in browser storage — document in [private-key-storage](../security/private-key-storage.md)
- No IDR passwords collected by SComm UI (SDK auth panel only)
- Audit `idr.connect` / `idr.disconnect` events without logging request bodies

## Compatibility

- **Outlook WebRTC support: Under Investigation** — see [webrtc-host-support](../microsoft/webrtc-host-support.md)
- HTTPS relay fallback may work where WebRTC is blocked
- `MockIdrTransport` for unit tests

## Open questions

- Storage persistence across Outlook WebView sessions on New Outlook Windows
- Enterprise policy blocking WebRTC/STUN/TURN
- Whether `transport: "https"` alone is acceptable for MVP on unsupported WebRTC hosts

## Decision

**Wrap `@idrto/idr_browser_sdk` in `packages/idr` as `IdrBrowserTransport`.** UI consumes `IdrTransport` and `AiProvider` only. CSP includes `https://idr.to`, `wss://idr.to`, and `https://*.idr.to`. MVP POC targets Ollama `/api/tags` via configurable service name.

## Implementation status

| Item | Status |
|------|--------|
| `IdrTransport` interface | Planned |
| `IdrBrowserTransport` | Planned (Milestone 6) |
| `MockIdrTransport` | Planned |
| Settings UI + connection test | Planned |
| CSP in manifest | Planned |

## Deferred work

- Multiple concurrent IDR connections
- `openStream()` for binary protocols
- Organization-approved IDR destination registry
- OpenAI/Anthropic cloud providers (non-IDR)
