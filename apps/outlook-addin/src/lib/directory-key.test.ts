import { describe, expect, it } from "vitest";
import { classifyDirectoryKey, decideSendGate } from "./directory-key";

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

  it("blocks send when a recipient has OpenPGP and Encrypt is off", () => {
    const gate = decideSendGate({
      bodyProtected: false,
      encrypt: false,
      sign: false,
      recipients: [alice],
      pgpEntitled: true,
    });
    expect(gate.allow).toBe(false);
    expect(gate.errorMessage).toMatch(/Encrypt/);
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
