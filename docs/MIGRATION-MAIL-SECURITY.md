# Migration: Mail Security SDK

## What changed

1. **New packages** under `packages/` for reusable SDK boundaries (see `docs/ARCHITECTURE-MAIL-SECURITY.md`).
2. **Compose UI** — Security pane adds Sign / Encrypt controls and Apply protection (RFC 3156).
3. **Send interception** — `OnMessageSend` blocks when encryption is required but unavailable (no silent downgrade).
4. **Legacy inline armor** — "Legacy body encryption" section retained for backward compatibility.

## Office add-in integration points

| File | Change |
|------|--------|
| `apps/outlook-addin/src/taskpane/components/ComposeSecurityControls.tsx` | Sign/Encrypt UX |
| `apps/outlook-addin/src/lib/mail-security-bridge.ts` | SDK orchestration |
| `apps/outlook-addin/src/lib/pre-send-security.ts` | Pre-send evaluation |
| `apps/outlook-addin/src/commands/commands.ts` | Send gate |
| `packages/office/src/submission-adapter.ts` | Transport abstraction |

## For developers consuming the SDK outside Outlook

```typescript
import { MailSecurityService } from "@scomm-office/mail-security";
import { OpenPgpCryptoProvider } from "@scomm-office/crypto-openpgp";

const service = new MailSecurityService();
// Register providers, call protectMessage(), submit via your adapter
```

No Office.js imports exist in crypto or MIME packages.

## Known platform limitation

Outlook compose cannot submit exact MIME trees via Office.js. Use generated `.eml` fixtures (`packages/crypto-openpgp/fixtures/`) for independent verification with GnuPG until Graph submission is wired.
