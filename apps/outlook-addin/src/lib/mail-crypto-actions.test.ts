import { describe, expect, it, vi } from "vitest";
import { MockMailHost } from "@scomm-office/office";
import { X_SCOMM_ENCRYPTION } from "@scomm-office/protocol";
import {
  createPubkeyClient,
  encodeBase64Url,
  formatOpenPgpLocator,
} from "@scomm-office/pubkeys";
import {
  decryptCurrentBody,
  encryptComposeBody,
  lookupRecipientStatuses,
  signComposeBody,
} from "./mail-crypto-actions";
import type { OfficePubkeySession } from "./pubkey-session";

// PGP add-on entitlement is billing-pgp.test.ts's concern; these tests exercise
// the crypto operations themselves and assume an entitled license.
vi.mock("./billing-pgp", () => ({ assertPgpAddon: vi.fn().mockResolvedValue(undefined) }));

async function buildSession(email: string): Promise<OfficePubkeySession> {
  const bundle = createPubkeyClient({ readBaseUrl: "https://pubkey.example.test" });
  await bundle.vault.createVault(email);
  return {
    ...bundle,
    secrets: undefined as never,
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

function mockGetBestKey(session: OfficePubkeySession, publicKeyByEmail: Record<string, Uint8Array>) {
  session.client.getBestKey = (async ({ email }: { email?: string }) => {
    const material = email ? publicKeyByEmail[email] : undefined;
    if (!material) return null;
    return {
      family: "pgp",
      algorithm: "openpgp-cv25519",
      public_material: encodeBase64Url(material),
    };
  }) as typeof session.client.getBestKey;
}

describe("decryptCurrentBody", () => {
  const email = "alice@example.com";

  it("round-trips encrypt -> decrypt", async () => {
    const session = await buildSession(email);
    const alice = await addPgpKey(session, email, 1);
    mockGetBestKey(session, { [email]: alice.publicKey });

    const mailHost = new MockMailHost({ mode: "compose", to: [{ emailAddress: email }], bodyText: "hello from the compose pane" });
    await encryptComposeBody({ session, mailHost, userEmail: email, sign: false });

    const result = await decryptCurrentBody({ session, mailHost });
    expect(result.plaintext.trim().length).toBeGreaterThan(0);
  });

  it("sets the X-SComm-Encryption header on the compose item once encrypted", async () => {
    const session = await buildSession(email);
    const alice = await addPgpKey(session, email, 1);
    mockGetBestKey(session, { [email]: alice.publicKey });

    const mailHost = new MockMailHost({
      mode: "compose",
      to: [{ emailAddress: email }],
      bodyText: "hello from the compose pane",
    });
    await encryptComposeBody({ session, mailHost, userEmail: email, sign: false });

    const headers = await mailHost.getHeaders();
    expect(headers[X_SCOMM_ENCRYPTION]).toBe("openpgp-v1");
  });

  it("selects the vault key that actually matches the ciphertext among several", async () => {
    const session = await buildSession(email);
    await addPgpKey(session, email, 1); // decoy — never used for encryption
    const target = await addPgpKey(session, email, 2);

    // Encrypt directly to the second key (bypassing directory lookup) so
    // the ciphertext's recipient key ID matches only vault key 2.
    const ciphertext = await session.pgpEngine.encrypt({
      plaintext: "for key two only",
      recipientPublicKey: target.publicKey,
    });
    const mailHost = new MockMailHost({
      mode: "read",
      bodyText: new TextDecoder().decode(ciphertext),
    });

    const result = await decryptCurrentBody({ session, mailHost });
    expect(result.plaintext).toBe("for key two only");
  });

  it("throws a clear error when no vault key matches the ciphertext", async () => {
    const session = await buildSession(email);
    await addPgpKey(session, email, 1);

    const stranger = await session.pgpEngine.generateKey({ email: "stranger@example.com" });
    const ciphertext = await session.pgpEngine.encrypt({
      plaintext: "not for you",
      recipientPublicKey: stranger.publicKey,
    });
    const mailHost = new MockMailHost({
      mode: "read",
      bodyText: new TextDecoder().decode(ciphertext),
    });

    await expect(decryptCurrentBody({ session, mailHost })).rejects.toThrow(/No Vault key/);
  });
});

describe("lookupRecipientStatuses", () => {
  it("treats directory 404 as a missing key", async () => {
    const email = "bob@example.com";
    const session = await buildSession(email);
    session.client.getBestKey = (async () => {
      throw Object.assign(new Error("Pubkey request failed (404)"), { status: 404, code: "not_found" });
    }) as typeof session.client.getBestKey;

    const rows = await lookupRecipientStatuses(session, [email]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("missing");
    expect(rows[0]?.hint).toMatch(/directory/i);
    expect(rows[0]?.hint).not.toMatch(/Directory lookup failed/);
  });

  it("uses the sender Vault key when the directory has no key for self", async () => {
    const email = "alice@example.com";
    const session = await buildSession(email);
    await addPgpKey(session, email, 1);
    session.client.getBestKey = (async () => {
      throw Object.assign(new Error("Pubkey request failed (404)"), { status: 404, code: "capability_mismatch" });
    }) as typeof session.client.getBestKey;

    const rows = await lookupRecipientStatuses(session, [email], { userEmail: email });
    expect(rows[0]?.status).toBe("found");
    expect(rows[0]?.addInCanEncrypt).toBe(true);
    expect(rows[0]?.publicMaterial?.byteLength).toBeGreaterThan(0);
  });
});

describe("signComposeBody", () => {
  it("signs without touching decryption entitlement", async () => {
    const email = "alice@example.com";
    const session = await buildSession(email);
    await addPgpKey(session, email, 1);

    const mailHost = new MockMailHost({ mode: "compose", bodyText: "hello there" });
    const note = await signComposeBody({ session, mailHost });
    expect(note).toMatch(/Signed/);

    const signedMessage = await mailHost.getCurrentMessage();
    expect(signedMessage.bodyText).toBe("hello there");
    expect(signedMessage.bodyText).not.toMatch(/BEGIN PGP SIGNED MESSAGE/);
    expect(signedMessage.attachments?.some((row) => row.name === "signature.asc")).toBe(true);
  });
});
