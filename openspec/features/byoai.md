# BYOAI — Bring Your Own AI

## Status

**Accepted**

## Context

secMail exposes Local AI (Ollama via Connect) and Cloud BYOAI (user API keys). Outlook uses **IDR** for local/BYOM routing and the same Cloud BYOAI profile model. See [constitution](../constitution.md) and [ai-trust-boundary](../security/ai-trust-boundary.md).

## Goals

- **Local:** connect via `@scomm-office/idr` → Ollama-compatible `/api/tags` + generate
- **Cloud:** OpenAI + OpenAI-compatible profiles (`baseUrl`, model, API key stored locally only)
- Entitlement gates aligned with billing add-ons (e.g. AI assistant)
- Wire semantic AI extract through configured provider (browser-origin)

## Non-goals

- SComm-hosted cloud models
- Privileged tools invoked solely from model output
- Server-side proxy of user API keys

## Constraints

- API keys never leave the add-in WebView except to the user-configured provider URL
- IDR remains a third-party subscription ([003-idr-transport](../architecture/003-idr-transport.md))
- Premium flows require active license entitlements when enforced

## Proposed design

Package: `packages/byoai` (`@scomm-office/byoai`)

- Local settings → `IdrTransport` + Ollama helpers from `@scomm-office/idr`
- Cloud profile repository + secure local key store
- `AiChatClient` / provider adapters used by task-pane Settings and semantics extractor

Task pane: Settings → AI with **Local (IDR)** and **Cloud (BYOAI)** subsections.

## Decision

**Ship Local + Cloud BYOAI in the client-only phase, gated by billing entitlements where configured.**
