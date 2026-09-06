import { describe, expect, it } from "vitest";
import { classifyDirectoryKey, decideSendGate, isDirectoryKeyMiss } from "./directory-key";

describe("classifyDirectoryKey", () => {
  it("treats classical OpenPGP as encryptable in the add-in", () => {
    const classified = classifyDirectoryKey({
      family: "pgp",
      algorithm: "openpgp-cv25519",
    });
    expect(classified.addInCanEncrypt).toBe(true);
    expect(classified.isPqc).toBe(false);
  });

  it("does not encrypt PQC OpenPGP from Outlook", () => {
    const classified = classifyDirectoryKey({
      family: "pgp",
      algorithm: "openpgp-mlkem768-x25519",
    });
    expect(classified.addInCanEncrypt).toBe(false);
    expect(classified.isPqc).toBe(true);
  });

  it("routes S/MIME to native Outlook", () => {
    const classified = classifyDirectoryKey({
      family: "smime",
      algorithm: "smime-rsa-oaep-sha256",
    });
    expect(classified.addInCanEncrypt).toBe(false);
    expect(classified.hint).toMatch(/native S\/MIME/i);
  });
});

describe("decideSendGate", () => {
  const alice = {
    email: "alice@example.com",
    status: "found" as const,
    ...classifyDirectoryKey({ family: "pgp", algorithm: "openpgp-cv25519" }),
  };

  it("allows send when Encrypt is off — the user chooses whether to protect", () => {
    const gate = decideSendGate({
      bodyProtected: false,
      encrypt: false,
      sign: false,
      recipients: [alice],
      pgpEntitled: true,
    });
    expect(gate.allow).toBe(true);
    expect(gate.needsProtect).toBe(false);
  });

  it("allows already-protected bodies", () => {
    const gate = decideSendGate({
      bodyProtected: true,
      encrypt: false,
      sign: false,
      recipients: [alice],
      pgpEntitled: true,
    });
    expect(gate.allow).toBe(true);
    expect(gate.needsProtect).toBe(false);
  });

  it("requires protection when Encrypt is on", () => {
    const gate = decideSendGate({
      bodyProtected: false,
      encrypt: true,
      sign: false,
      recipients: [alice],
      pgpEntitled: true,
    });
    expect(gate.allow).toBe(true);
    expect(gate.needsProtect).toBe(true);
  });

  it("when Encrypt is on, missing directory keys ask the user to publish", () => {
    const missing = {
      email: "bob@example.com",
      status: "missing" as const,
      family: "unknown" as const,
      algorithm: "",
      isPqc: false,
      addInCanEncrypt: false,
      hint: "No key published on the pubkey directory.",
    };
    const gate = decideSendGate({
      bodyProtected: false,
      encrypt: true,
      sign: false,
      recipients: [missing],
    });
    expect(gate.allow).toBe(false);
    expect(gate.errorMessage).toMatch(/no OpenPGP key on the pubkey directory/i);
  });

  it("treats HTTP 404 as a missing key, not a transport error", () => {
    expect(
      isDirectoryKeyMiss({ status: 404, code: "not_found", message: "Pubkey request failed (404)" }),
    ).toBe(true);
    expect(isDirectoryKeyMiss({ status: 500, code: "server_error", message: "boom" })).toBe(false);
  });

  it("does not block solely because a recipient has S/MIME", () => {
    const bob = {
      email: "bob@example.com",
      status: "found" as const,
      ...classifyDirectoryKey({ family: "smime", algorithm: "smime-rsa-oaep-sha256" }),
    };
    const gate = decideSendGate({
      bodyProtected: false,
      encrypt: false,
      sign: false,
      recipients: [bob],
      pgpEntitled: true,
    });
    expect(gate.allow).toBe(true);
  });

  it("does not force encrypt when the pgp add-on is missing", () => {
    const gate = decideSendGate({
      bodyProtected: false,
      encrypt: false,
      sign: false,
      recipients: [alice],
      pgpEntitled: false,
    });
    expect(gate.allow).toBe(true);
    expect(gate.needsProtect).toBe(false);
  });

  it("blocks explicit Encrypt/Sign when the pgp add-on is missing", () => {
    const gate = decideSendGate({
      bodyProtected: false,
      encrypt: true,
      sign: false,
      recipients: [alice],
      pgpEntitled: false,
    });
    expect(gate.allow).toBe(false);
    expect(gate.errorMessage).toMatch(/pgp/i);
  });
});
