import { describe, expect, it } from "vitest";
import { createPubkeyClient, encodeBase64Url, formatOpenPgpLocator } from "@scomm-office/pubkeys";
import type { ComposeSnapshot } from "@scomm-office/message-core";
import { protectComposeSnapshot } from "./mail-security-bridge";
import type { OfficePubkeySession } from "./pubkey-session";

async function buildSession(email: string): Promise<OfficePubkeySession> {
  const bundle = createPubkeyClient({ readBaseUrl: "https://pubkey.example.test" });
  await bundle.vault.createVault(email);
  return {
    ...bundle,
    secrets: undefined as never,
    deviceIdentity: undefined as never,
    pendingMsk: null,
    msk: null,
  };
}

async function addPgpKey(session: OfficePubkeySession, email: string, keyId: number) {
  const generated = await session.pgpEngine.generateKey({ email });
  session.vault.addKey({
    kind: "content",
    key_id: keyId,
    family: "pgp",
    purpose: "encryption",
    algorithm: "openpgp-cv25519",
    fingerprint: generated.fingerprint,
    locator: formatOpenPgpLocator(generated.fingerprint),
    status: "active",
    private_material: generated.privateKey,
  });
  return generated;
}

function snapshotTo(email: string): ComposeSnapshot {
  return {
    subject: "Hi",
    authoredText: "hello",
    from: { emailAddress: email },
    to: [{ emailAddress: email }],
    capturedAt: new Date().toISOString(),
    nonce: "test-nonce",
  };
}

describe("protectComposeSnapshot", () => {
  it("still encrypts when the signing-key lookup throws but the encryption lookup succeeds", async () => {
    const email = "alice@example.com";
    const session = await buildSession(email);
    const alice = await addPgpKey(session, email, 1);

    // Regression test: an earlier bug shared one try/catch across both the
    // encryption-key and signing-key lookups, so a signing-lookup failure
    // silently discarded an already-successful encryption-key lookup,
    // blocking sends with "Encryption unavailable" even though a valid key
    // existed. The two lookups must be resolved independently.
    session.client.getBestKey = (async ({ email: lookupEmail, purpose }) => {
      if (purpose === "signing") {
        throw new Error("signing lookup unavailable");
      }
      if (lookupEmail === email) {
        return { family: "pgp", algorithm: "openpgp-cv25519", public_material: encodeBase64Url(alice.publicKey) };
      }
      return null;
    }) as typeof session.client.getBestKey;

    const result = await protectComposeSnapshot(session, snapshotTo(email), email, {
      sign: false,
      encrypt: true,
      protocol: "automatic",
    });

    expect(result.decision.allowed).toBe(true);
    expect(result.decision.negotiation.compatibleRecipients).toBeGreaterThan(0);
  });
});
