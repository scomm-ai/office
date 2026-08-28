# SComm Mail Security Architecture

## Layer separation

```text
Outlook (Office.js)
        |
SComm Office Add-in (compose/read UI, send interception)
        |
Office Adapter (MailHost, OfficeSubmissionAdapter)
        |
SComm Message Model (@scomm-office/message-core)
        |
+-----------+-----------+-----------+
|           |           |           |
Policy   Capability   Semantic    MIME
Engine   Negotiation  Signatures  SDK
|           |           |           |
+-----------+-----------+-----------+
                    |
              Crypto Core
                    |
         +----------+----------+
         |                     |
   OpenPGP Provider      S/MIME Provider
   (RFC 3156 MIME)       (CMS — native bridge)
                    |
            Submission Adapter
                    |
         Microsoft 365 / Graph / SMTP
```

## Packages

| Package | Role |
|---------|------|
| `@scomm-office/message-core` | Logical message, canonical authored text |
| `@scomm-office/mime` | RFC 2045/3156 MIME builder and detector |
| `@scomm-office/crypto` | Crypto interfaces, key handles, errors, cache |
| `@scomm-office/crypto-openpgp` | OpenPGP/MIME sign, encrypt, verify, decrypt |
| `@scomm-office/crypto-smime` | S/MIME abstraction (fail-closed in JS hosts) |
| `@scomm-office/semantic-signatures` | SComm semantic manifest signing/verification |
| `@scomm-office/capability-negotiation` | Protocol family selection |
| `@scomm-office/policy` | Compliance + send security policy |
| `@scomm-office/mail-security` | Orchestration service for apps |
| `@scomm-office/pubkeys` | pubkey.scomm.ai discovery (not a crypto dependency) |

## Standards vs SComm-specific

- **OpenPGP/MIME** — RFC 3156 `multipart/signed` and `multipart/encrypted`. Independently verifiable.
- **S/MIME** — Standard CMS/S/MIME. Platform trust stores for PKI.
- **Semantic signature** — Additional layer over canonical authored plain text. Survives benign transport mutations.

## Authoritative content

- Plain-text authored body is signed by semantic manifests.
- HTML is presentation; verification exposes `htmlCorrespondence: match | differs | unknown`.
- Attachments authenticated by SHA-256 of decoded binary content.

## Private keys

Private keys remain behind `SigningKeyHandle` / `DecryptionKeyHandle`. The Office add-in requests operations via handles backed by CKVF/SComm Vault — not raw key bytes in UI code.

## pubkey.scomm.ai

Discovery only. Thunderbird and other clients verify OpenPGP output without SComm once they have the public key.

## Microsoft submission limitation

Office.js cannot inject an arbitrary final MIME tree. The SDK always generates correct RFC 3156 MIME. `OfficeSubmissionAdapter` applies the best supported Office.js path; `MicrosoftGraphSubmissionAdapter` is the intended future transport for exact MIME submission.

## Migration from inline armor

Legacy compose flow used armored inline PGP in the body. New flow uses `@scomm-office/mail-security` with RFC 3156 structures. Legacy decrypt path remains for reading older messages.

See also: `docs/THREAT-MODEL-MAIL-SECURITY.md`, `docs/MIGRATION-MAIL-SECURITY.md`.
