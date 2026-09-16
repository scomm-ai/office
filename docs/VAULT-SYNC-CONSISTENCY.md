# Office ↔ secMail10 vault sync consistency

**Scope:** the shared CKVF vault document — `vault_generations` on the pubkey
server (`C:\dev\package\pubkey\pubkey`), written by both this add-in and
secMail10 (`C:\dev\secMail10`).

**Why it matters more than an ordinary interop bug:** a vault generation is
immutable and never deleted. A bad generation stays *current* until some
client manages to replace it — so a client that cannot read the current
generation also cannot upload a fix. There is no self-healing.

**Affected code:** `packages/scomm-pubkey/src/vault/vault.js`,
`apps/outlook-addin/src/lib/pubkey-session.ts`
**Regression tests:** `packages/scomm-pubkey/test/vault-sync-consistency.test.js`,
the `publishPgpContentKey vault sync` block in
`apps/outlook-addin/src/lib/pubkey-session.test.ts`, and (secMail10 side)
`packages/scomm_pubkey/test/vault_office_interop_test.dart`

## At a glance

| # | Issue | Status |
|---|-------|--------|
| 1 | Canonical key pointers written as JSON numbers → secMail10 cannot load the vault at all | ✅ **FIXED** |
| 2 | Pointers *derived* from "highest active key id" instead of round-tripped | ✅ **FIXED** |
| 3 | A retirement made on another device was ignored, then re-uploaded as `active` | ✅ **FIXED** |
| 4 | `metadata.devices` overwritten with `[]` on every upload | ✅ **FIXED** |
| 5 | Creating a key uploaded no vault generation — private material stayed in IndexedDB | ✅ **FIXED** |
| 6 | `addKey` dropped the server `key_id` when deduping by fingerprint | ✅ **FIXED** |
| — | No key retire/revoke flow in the add-in at all | ℹ️ Gap, not a bug — see below |

Every item was reproduced by a failing test before being changed.

## 1. Canonical key pointers were written as numbers

`exportVaultCiphertext` wrote `current_signing_key_id` /
`current_encryption_key_id` as raw `key_id` numbers. Every other key id in the
same document is a **string** (each goes through `idOf`), and secMail10 reads
these two with a `String?` cast.

A number there throws `TypeError: type 'int' is not a subtype of type
'String?'` from the middle of secMail10's `_applyPlaintextBytes` — not a
`PubkeyException`, so nothing maps it to a user-facing error. The vault ends
up empty and locked. Combined with immutable generations, an identity that
synced once from Office could no longer use its vault in secMail10 *at all*,
with no way back.

**Fix:** pointers are serialized through a `keyIdPointer` helper that always
produces a string or `null`. secMail10's reader was additionally made tolerant
of both spellings, so identities already holding such a generation recover
instead of staying wedged.

## 2. Pointers were derived, not preserved

The written value came from `getCurrentKey(purpose)` — "the active entry with
the highest `key_id`". The vault has no such rule. These pointers record an
explicit, user-confirmed promotion ("make this the key new senders see"),
which is exactly why secMail10 never sets them automatically.

So an Office sync silently re-pointed the identity's advertised key at
whichever key happened to be newest, discarding the user's actual choice — and
invented a pointer even when the user had promoted nothing.

**Fix:** the two pointers are read from the downloaded snapshot, held on the
Vault, and written back unchanged. Office sets them nowhere; it has no
promotion flow. `retireKey` clears a pointer naming the key it retires (a
retired artifact is not discoverable, so calling it advertised is false), and
clears rather than re-points, for the same reason.

## 3. Retirements from another device were ignored, then undone

`applyRemoteSnapshot` merged remote entries through `addKey`, which dedupes by
fingerprint and returns the copy already held **unchanged**. A key retired in
secMail10 therefore stayed `active` in Office — and worse, Office's next upload
pushed it back up as `active`, resurrecting a key the user had deleted.

This is the cross-client twin of the additive-only-hydrate bug documented for
secMail10 in `docs/security/crypto-vault-sync-key-deletion-bugs.md` §3.

**Fix:** `applyRemoteSnapshot` reconciles status after each merge. `retired`
and `revoked` are terminal: a snapshot may move a local entry into a terminal
state, and `revoked` may supersede `retired`, but nothing returns an entry to
`active`.

## 4. `metadata.devices` was overwritten with an empty list

`exportVaultCiphertext` hard-coded `metadata: { devices: [] }`, and
`decryptVaultCiphertext` did not read the field back. Every Office upload
therefore erased the identity's device roster.

secMail10 branches its device-compromise response on that roster
(`PubkeyRuntime.respondToFullDeviceCompromise`): with it empty, it concludes
this was the identity's only full-authority device and routes the user into
OTP-only identity recovery instead of an ordinary VEK/AEK rotation.

**Fix:** the roster is round-tripped like the pointers. Office adds no devices
of its own to it.

## 5. Creating a key uploaded no vault generation

`publishPgpContentKey` published the public artifact (`public_key_artifacts`)
and then called only `vault.persist(secret)` — a write to this browser's
IndexedDB. Nothing reached `vault_generations`. The private half of a freshly
created key left the device only if the user later happened to click "Sync with
Scomm.AI": until then, clearing the Office profile destroyed the only copy, and
no other device could read mail sent to that key.

secMail10 uploads the vault in the same action that publishes the artifact —
one user action, one generation.

**Fix:** `publishPgpContentKey` persists locally first (so a failed upload can
never lose the key), then syncs. It uses `syncVault` rather than `uploadVault`
because the upload is hash-chained onto the current generation, so the device
has to be on it first.

Two deliberate limits:

- **A device with no VRK does not upload, and does not mint one.** Minting a
  Vault Root Key here would fork the identity: the device would push a
  generation nobody else can decrypt while still unable to read the existing
  ones. Such a device simply has not been added yet.
- **A failed upload is reported, not thrown.** By that point the artifact is
  published and the key is in local storage; throwing would report a key that
  genuinely exists as not created. The result carries
  `vaultSynced` / `vaultSyncError`, and the Vault panel tells the user the key
  is local-only and to run Sync.

## 6. `addKey` dropped the server key id when deduping

On a fingerprint match, `addKey` merged `locator`/`locators` from the incoming
copy into the stored entry but discarded `key_id`. An encryption key sits in
the vault unpublished (no server id) until it is published, and publishing
re-adds the same material carrying the id the server just minted — which was
thrown away, leaving the entry unreachable by `getKey`, and therefore by
`retireKey`.

Identical to the secMail10 bug recorded in
`docs/security/crypto-vault-sync-key-deletion-bugs.md` §13, and fixed the same
way: back-fill only when absent, never overwrite an id already present (a
*different* id for the same material is a conflict, not new information).

## Gap: no key retire/revoke flow in the add-in

The add-in can revoke *devices*, but has no UI to retire, archive, or delete a
*key*; `Vault.retireKey` is never called from `apps/outlook-addin`, and there
is no `revokeKey` at all (secMail10 has both). Item 3 above is about honouring
a retirement made elsewhere, which is what actually matters today.

Adding a `revokeKey` no caller uses would be speculative, so it was left out.
If a key-lifecycle UI is added here, it needs `revokeKey` (terminal state
`revoked`, distinct from `retired`) and the server-side `retire_key` call
alongside the vault mutation — see secMail10's
`KeyManagementService._retireOnServer` for the shape, including its
`key_id_conflict` tolerance.

## Verification

Beyond the unit tests, the full cross-client round trip was exercised on real
bytes: secMail10 uploads a generation (key 5 promoted, key 4 retired, one
device) → Office pulls it, adds a newly generated key, and pushes back → the
resulting plaintext is fed to secMail10's own parser. It loads with the
promotion pointer still `5` (not re-pointed at the newer key), the signing
pointer intact, the device roster intact, key 4 still retired, and Office's new
key present with its private material. Before these fixes the same sequence
threw a `TypeError` in secMail10, emptied the device roster, re-pointed the
advertised key, and un-retired key 4.

Suites: `packages/scomm-pubkey` 83 passing; `apps/outlook-addin` 75 passing
(12 files — the 5 failing files are a pre-existing missing `@2key/browser-sdk`
workspace dependency, unrelated); the rest of the monorepo unchanged, with
`apps/server`'s integration test skipped as usual without a local Postgres on
5433. secMail10: `scomm_pubkey` 153 passing, crypto suite 181 passing.
