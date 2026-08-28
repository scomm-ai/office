# Mail Security Threat Model

## Threats and mitigations

| Threat | Layer |
|--------|-------|
| Mail provider rewriting MIME | Semantic signature (canonical text); whole-message encryption hides inner MIME |
| Gateway adding disclaimers | Semantic segments; unsigned transit content flagged |
| Gateway modifying HTML | `htmlCorrespondence: differs` while text signature valid |
| Attachment substitution | Attachment SHA-256 in semantic manifest |
| Recipient-header modification | Subject/to/cc in semantic manifest |
| Malicious HTML differing from signed text | Separate HTML correspondence state |
| Key substitution | Identity binding vs signature validity; pubkey cache + fingerprints |
| Stale cached keys | Public key cache with `lastValidated`, full fingerprints |
| Revoked keys | Key status in cache; verification state `revoked` |
| Private-key extraction | Key handles; vault encryption; no raw keys in UI |
| Silent encryption downgrade | Policy + negotiation block send; explicit errors |
| Bcc privacy leakage | Bcc excluded from semantic recipient manifests |
| Provider transport headers | Excluded from semantic canonicalization |

## Verification concepts (never collapsed)

1. **Cryptographic validity** — signature decrypts/verifies
2. **Key trust** — PKI / WoT / enterprise policy
3. **Identity binding** — key authorized for mailbox
4. **Semantic correspondence** — authored text, attachments, HTML

## Standards signatures

OpenPGP/MIME and S/MIME authenticate MIME bytes per RFC. They may fail after gateway mutation — that is correct behavior. Semantic signatures address logical content integrity separately.
