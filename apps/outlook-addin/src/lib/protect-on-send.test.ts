import { describe, expect, it, vi } from "vitest";
import { MockMailHost } from "@scomm-office/office";
import { createPubkeyClient, encodeBase64Url, formatOpenPgpLocator } from "@scomm-office/pubkeys";
import { protectOnSend } from "./protect-on-send";
import type { OfficePubkeySession } from "./pubkey-session";

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

describe("protectOnSend", () => {
  const email = "alice@example.com";

  it("allows send when Encrypt is off — the user chooses whether to protect", async () => {
    const session = await buildSession(email);
    const alice = await addPgpKey(session, email, 1);
    session.client.getBestKey = (async () => ({
      family: "pgp",
      algorithm: "openpgp-cv25519",
      public_material: encodeBase64Url(alice.publicKey),
    })) as typeof session.client.getBestKey;

    const mailHost = new MockMailHost({
      mode: "compose",
      to: [{ emailAddress: email }],
      bodyText: "hello",
    });
    const result = await protectOnSend({
      session,
      mailHost,
      userEmail: email,
      toggles: { encrypt: false, sign: false },
    });
    expect(result.outcome).toBe("allow-native");
  });

  it("writes armor only (not MIME headers) when Graph is unavailable", async () => {
    const session = await buildSession(email);
    const alice = await addPgpKey(session, email, 1);
    session.client.getBestKey = (async () => ({
      family: "pgp",
      algorithm: "openpgp-cv25519",
      public_material: encodeBase64Url(alice.publicKey),
    })) as typeof session.client.getBestKey;

    const mailHost = new MockMailHost({
      mode: "compose",
      to: [{ emailAddress: email }],
      from: { emailAddress: email },
      bodyText: "hello from compose",
    });
    const result = await protectOnSend({
      session,
      mailHost,
      userEmail: email,
      toggles: { encrypt: true, sign: false },
    });
    expect(result.outcome).toBe("body-protected");
    const current = await mailHost.getCurrentMessage();
    expect(current.bodyHtml).toContain("BEGIN PGP MESSAGE");
    expect(current.bodyHtml).not.toContain("Content-Type:");
    expect(current.bodyText).not.toMatch(/^Content-Type:/);
  });

  it("uses Graph when submit succeeds and leaves the compose body unchanged", async () => {
    const session = await buildSession(email);
    const alice = await addPgpKey(session, email, 1);
    session.client.getBestKey = (async () => ({
      family: "pgp",
      algorithm: "openpgp-cv25519",
      public_material: encodeBase64Url(alice.publicKey),
    })) as typeof session.client.getBestKey;

    const mailHost = new MockMailHost({
      mode: "compose",
      to: [{ emailAddress: email }],
      from: { emailAddress: email },
      bodyText: "hello from compose",
    });
    const graphSubmit = vi.fn(async () => undefined);
    const result = await protectOnSend({
      session,
      mailHost,
      userEmail: email,
      toggles: { encrypt: true, sign: false },
      graphSubmit,
    });
    expect(result.outcome).toBe("graph-sent");
    expect(graphSubmit).toHaveBeenCalledOnce();
    const current = await mailHost.getCurrentMessage();
    expect(current.bodyText).toBe("hello from compose");
  });

  it("falls back to armor in the body when Graph submit fails", async () => {
    const session = await buildSession(email);
    const alice = await addPgpKey(session, email, 1);
    session.client.getBestKey = (async () => ({
      family: "pgp",
      algorithm: "openpgp-cv25519",
      public_material: encodeBase64Url(alice.publicKey),
    })) as typeof session.client.getBestKey;

    const mailHost = new MockMailHost({
      mode: "compose",
      to: [{ emailAddress: email }],
      from: { emailAddress: email },
      bodyText: "hello from compose",
    });
    const result = await protectOnSend({
      session,
      mailHost,
      userEmail: email,
      toggles: { encrypt: true, sign: false },
      graphSubmit: async () => {
        throw new Error("Silent Graph session unavailable");
      },
    });
    expect(result.outcome).toBe("body-protected");
    const current = await mailHost.getCurrentMessage();
    expect(current.bodyHtml).toContain("BEGIN PGP MESSAGE");
  });
});
