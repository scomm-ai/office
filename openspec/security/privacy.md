# Privacy Architecture

## Status

**Accepted**

## Context

SComm Office moves data between Outlook, Microsoft Graph, SComm servers, pubkey directory, IDR targets, and optional AI providers. Users and administrators need transparency about what leaves the device.

## Problem

Implicit data sharing (especially AI over email content) erodes trust and may violate organizational policy or regulations. Undocumented flows complicate DPIA and admin consent decisions.

## Goals

- Categorize all data flows with purpose, payload, retention, auth, and disable controls
- Default to minimal exfiltration
- Prefer local/BYOM via IDR for AI processing
- Never log message bodies or tokens by default

## Non-goals

- Legal compliance certification
- GDPR/CCPA formal documentation (foundation only)
- User-facing privacy policy text (product/legal team)

## Constraints

- Audit logs need operational metadata without content
- Some flows require Microsoft 365 admin consent
- IDR BYOM still exposes selected content to user's own agent

## Proposed design

### Data flow matrix

| Flow | Purpose | Data sent | Retention | Auth | TLS | User can disable |
|------|---------|-----------|-----------|------|-----|------------------|
| **Outlook → Add-in** | Read/compose current item | Body, headers, recipients, attachments metadata | Session memory | Office.js user context | N/A (in-process) | Uninstall add-in |
| **Add-in → Microsoft Graph** | Thread context, profile | Message IDs, conversation messages, user profile | Session cache | NAA OAuth | Yes | Disable Graph features |
| **Add-in → SComm server** | Config, policy, audit | Config requests, audit events (redacted), optional semantics ref | Server policy | Dev token / future federation | Yes | Point to self-hosted or off |
| **Add-in → Pubkey server** | Key discovery/publish | Email identity, public keys only | Client cache TTL | Server auth | Yes | Disable identity features |
| **Add-in → IDR (idr.to)** | BYOM AI/connectivity | Signaling, PoP, tunneled HTTP to user agent | SDK session storage | IDR account | Yes | Disable IDR settings |
| **Add-in → AI via IDR** | Summarize, extract actions | User-selected excerpts/prompts | User agent local | Via IDR tunnel | Yes | No AI provider configured |
| **Add-in → Cloud AI** (future) | Optional cloud models | Prompts (explicit) | Provider policy | Provider API key via server | Yes | Org policy / not configured |

### Data categories

| Category | Examples | Default logging | Default telemetry |
|----------|----------|-----------------|-------------------|
| **Content** | Body text, attachment bytes | Never | Never |
| **Metadata** | Subject hash, recipient domains | Redacted audit | Aggregated counts |
| **Identity** | Email addresses, key IDs | Partial redaction | Hashed |
| **Secrets** | Tokens, private keys | Never | Never |
| **Diagnostics** | Capability flags, errors | Yes (no PII) | Yes |

### AI privacy rules

- No automatic send of email body to AI
- User initiates each AI action OR org policy enables compose-time analysis (future)
- Display provider status before execution:
  - "AI processing: Local via IDR → ai-box.user.idr"
  - "AI processing: Cloud — OpenAI" (future)
- Prompt construction excludes unrelated thread messages unless user opts in

### Audit event redaction

```typescript
// Allowed audit fields
{ event: "semantic.analysis", durationMs: 120, segmentCount: 5 }

// Forbidden
{ body: "...", graphToken: "...", privateKey: "..." }
```

See audit types in implementation plan.

### Settings transparency

Settings panel shows effective data destinations:

- SComm Server URL (configured / default)
- Pubkey Server URL
- IDR target host
- Graph: enabled/disabled
- AI: none / IDR / cloud

### Organization override

`EffectiveConfiguration.organization` may:

- Disable cloud AI entirely
- Restrict IDR to approved hosts
- Require external recipient warnings
- Force audit to org SComm server

User settings cannot override enforced org policy.

## Alternatives

| Alternative | Why rejected |
|-------------|--------------|
| Send all mail to cloud AI for "smart" features | Privacy violation default |
| No audit logging | Enterprise requirement |

## Security considerations

- Privacy complements [threat-model](./threat-model.md) — limits blast radius
- IDR still transits idr.to infrastructure — document in user-facing copy
- Graph Mail.Read exposes mailbox content user may not have visually opened

## Compatibility

- Mock/dev mode logs to console only
- Self-hosted SComm server reduces third-party retention

## Open questions

- Data residency requirements per tenant region
- Retention period for server-side semantics (when persisted)
- DSR (delete request) workflow across pubkey server

## Decision

**Document all flows in this matrix. MVP defaults: no cloud AI, explicit IDR test, Graph optional, audit redacted, no body logging.**

## Implementation status

| Item | Status |
|------|--------|
| Audit redaction helpers | Planned |
| Settings transparency UI | Planned |
| Privacy matrix in README | Planned |

## Deferred work

- Formal DPIA template
- User data export/delete APIs
- Regional deployment guide
