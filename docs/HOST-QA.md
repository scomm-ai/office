# Host QA + cross-device matrix

Two independent planes. Do not mix them.

## Outlook add-in ↔ secMail0 (inline OpenPGP)

| Step | Outlook add-in | secMail0 |
|------|----------------|----------|
| Publish | Security pane: enroll MSK, publish OpenPGP | Publish OpenPGP (and optionally S/MIME) |
| Encrypt | Encrypt body → `BEGIN PGP MESSAGE` in `text/plain` | Encrypt when GET `family=pgp` |
| Decrypt | Security pane `<pre>` only — never `setBody` plaintext | HTML-stripped inline armor decrypt |
| Sent | Self included as recipient; decrypt Sent in the pane | Self included in PKESK |
| Leak | `OnMessageSend` **Block** if directory PGP and body has no armor | n/a |

Hosts: OWA + new Outlook. Confirm HTML wrap (`<br>`, split spans) still decrypts.

## secMail0 ↔ Outlook native S/MIME

| Step | secMail0 | Outlook native |
|------|----------|----------------|
| Cert | Export `.cer` or send signed-data | Import cert / add from signed mail |
| Encrypt | MIME-entity CMS, AES-256-CBC | Encrypt to imported cert (self-signed warning is expected) |
| Decrypt | AES-128/256, RSA PKCS#1 or OAEP, `.p7m` | CAPI decrypt of mail **to you** (no public CA required) |

The add-in must **not** advertise `smime` or Graph-send CMS.

## Vault

Export/import the SComm Vault with a user passphrase. Warn that host IndexedDB can vanish.

## Pubkey

`/v1/msk/enroll`, `/v1/mutate`, `/v1/keys`. Lookup is consistent hash. Production: SMTP, Redis JTI, TLS, abuse, captcha/IP blocks on. Fail closed without the gRPC hub.
