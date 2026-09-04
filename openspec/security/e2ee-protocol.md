# End-to-End Encryption Protocol

## Status

**Locked for this product slice**

## Decision

Two independent interop planes. They do not share engines.

| Client | Mail E2EE | Directory families |
|--------|-----------|--------------------|
| Outlook add-in | Inline OpenPGP armor (`text/plain` + `BEGIN PGP MESSAGE`) via `@scomm/pubkey` `PgpEngine` | `{ pgp: [openpgp-cv25519, openpgp-ed25519] }` only |
| secMail0 | Inline OpenPGP **and** RFC 5751 S/MIME CMS (libcrypto) | `pgp` and `smime` |
| Outlook native S/MIME | Windows/CAPI + imported or signed-mail certs | Not published by the add-in |

The add-in **must not** implement or advertise a JS `SmimeEngine`, Graph-send CMS, GAL, or CAPI cert install. Native Outlook S/MIME never goes through the add-in engine.

There is **no** SComm-proprietary ECDH envelope (`scomm-v1-ecdh-p256-aes256gcm` is deleted).

## Outlook add-in profile

- Encrypt UTF-8 body text to armored `PGP MESSAGE`. Include self as recipient so Sent items decrypt.
- Sign as clearsigned OpenPGP. Encrypt may embed a signature when Sign is also on.
- Decrypt into the Security pane `<pre>` only. Do not `setBody` plaintext.
- Verify using the sender signing key from pubkey.scomm.ai.
- Harden HTML unwrap (`<br>`, split spans, `\r\n`) before OpenPGP parse.
- Ribbon Encrypt / Sign persist compose flags; `OnMessageSend` **Block** when To/Cc/Bcc have a directory OpenPGP key the add-in can encrypt to and the body has no OpenPGP protection **and** the user has the paid `pgp` add-on. Without `pgp`, plaintext send is allowed; Encrypt / Sign / key publish fail closed.
- Decrypt and signature verify do **not** require `pgp` so inbound mail stays readable.
- Classical OpenPGP only. S/MIME and PQC keys are explained in the pane; they are not encrypted by this add-in.

## secMail0 profile

- When GET returns `family: pgp`, encrypt with OpenPGP (Outlook users).
- When GET returns `family: smime`, encrypt the MIME entity with CMS (Outlook native).
- Cert exchange: export `.cer` / PEM, import `.cer` / `.p7b`, extract certs from signed S/MIME, send signed-data so Outlook can add the cert.
- Outlook warns on self-signed when **encrypting to** that cert; decrypt of mail **to you** does not need a public CA.

## Interfaces

`@scomm-office/crypto` keeps `MessageEncryptor` / `MessageDecryptor` as throwing stubs. Production mail crypto is `PgpEngine` in the Security panel, not those interfaces.

## Out of scope

JS/CMS engine, Graph `Mail.Send`, GAL, CAPI injection, PGP/MIME, PQ/`smime-mlkem-*`, hardware MSK adapters.
