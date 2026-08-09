# Milestone Report — Vertical Slice 1

## IMPLEMENTED

- pnpm TypeScript monorepo (`@scomm-office/*`) with ESLint, Prettier, Vitest, GitHub Actions CI
- OpenSpec architecture / microsoft / features / security / deferred docs
- Packages: core, protocol, identity, config, observability, storage, testkit, office, semantics, pubkeys, idr, policy, crypto, microsoft-graph
- Apps: outlook-addin (React/Vite HTTPS), server (Fastify + Postgres), dev-console
- MailHost + MockMailHost + OutlookMailHost + capability registry
- Heuristic semantic extractor (authored/quoted/forwarded/signature/legalese)
- X-SComm metadata adapter + semantic digest
- PublicKeyDirectory (HTTP + mock + cache) with Postgres-backed server routes
- IdrTransport wrapping `@idrto/idr_browser_sdk` + OllamaViaIdrProvider `/api/tags` POC
- Deterministic policy engine + OnMessageSend/Compose/Decrypt command scaffolds
- MSAL Graph / E2EE / durable key storage experimental stubs

## TESTED

- Package unit tests (semantics fixtures, pubkey, IDR mock, policy, capabilities, etc.)
- Server integration tests against Postgres `localhost:5433`
- Add-in and dev-console unit tests
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`

## DEFERRED

- Production E2EE and private-key persistence
- Verified WebRTC matrices across Outlook hosts
- SComm MIME `application/scomm+json`
- Full Nestled App Authentication Graph wiring with real Entra app registration
- Production pubkey trust/verification
- Formal compliance certifications

## OPEN QUESTIONS

- Unified vs XML manifest for Marketplace publishing
- Organizational IDR destination allowlists
- Server-issued UID federation

## OPENSPEC DOCUMENTS CREATED

See [`openspec/README.md`](../openspec/README.md).

## KNOWN OUTLOOK LIMITATIONS

- Mobile does not support OnMessageSend / Smart Alerts
- Internet headers require Mailbox 1.8+
- NAA unavailable for Outlook.com/Gmail mailboxes
- WebRTC support not claimed until host-tested (see `openspec/microsoft/webrtc-host-support.md`)

## NEXT RECOMMENDED WORK

1. Register Entra app + complete NAA Graph path on supported hosts
2. Sideload matrix testing (Outlook Web, new Windows, classic, Mac)
3. Harden IDR CSP and relay hostname allowlist in production builds
4. Persist compose-time semantic cache for send-path policy evaluation
