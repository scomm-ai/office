export type DirectoryKeyFamily = "pgp" | "smime" | "unknown";

export interface ClassifiedDirectoryKey {
  family: DirectoryKeyFamily;
  algorithm: string;
  isPqc: boolean;
  /** This Outlook add-in can encrypt to the key (classical OpenPGP only). */
  addInCanEncrypt: boolean;
  hint: string;
}

const PQC_RE = /mlkem|mldsa|kyber|dilithium|pqc|rfc.?9980|sphincs|falcon/i;

export function wireFamily(family: string | undefined | null): DirectoryKeyFamily {
  const value = String(family || "").toLowerCase();
  if (value === "pgp" || value === "openpgp") return "pgp";
  if (value === "smime" || value === "s/mime" || value === "cms") return "smime";
  return "unknown";
}

export function classifyDirectoryKey(input: {
  family?: string | null;
  algorithm?: string | null;
  suite?: string | null;
}): ClassifiedDirectoryKey {
  const family = wireFamily(input.family);
  const algorithm = String(input.algorithm || input.suite || "").trim();
  const isPqc = PQC_RE.test(algorithm);
  const classicalPgp =
    family === "pgp" &&
    !isPqc &&
    (algorithm === "" ||
      algorithm.startsWith("openpgp") ||
      algorithm.includes("cv25519") ||
      algorithm.includes("ed25519") ||
      /rsa|nistp|x25519/i.test(algorithm));

  if (family === "smime") {
    return {
      family,
      algorithm,
      isPqc,
      addInCanEncrypt: false,
      hint: isPqc
        ? "Scomm.AI PQC S/MIME — use the Scomm.AI mail client. Native Outlook cannot decrypt it."
        : "Classical S/MIME — use Outlook native S/MIME, not this add-in.",
    };
  }

  if (family === "pgp" && isPqc) {
    return {
      family,
      algorithm,
      isPqc,
      addInCanEncrypt: false,
      hint: "RFC 9980 OpenPGP PQC — encrypt from the Scomm.AI mail client. This add-in and GpgOL are classical only.",
    };
  }

  if (classicalPgp) {
    return {
      family,
      algorithm: algorithm || "openpgp-cv25519",
      isPqc: false,
      addInCanEncrypt: true,
      hint: "Classical OpenPGP — Scomm.AI, Thunderbird, and GpgOL can encrypt to this key.",
    };
  }

  return {
    family,
    algorithm,
    isPqc,
    addInCanEncrypt: false,
    hint: "No compatible encryption key for this Outlook add-in.",
  };
}

export interface RecipientDirectoryStatus extends ClassifiedDirectoryKey {
  email: string;
  status: "found" | "missing" | "error";
  error?: string;
  /** Binary public key when lookup used the local Vault instead of the directory. */
  publicMaterial?: Uint8Array;
}

/** GET /v1/keys 404 / no matching artifact — not a transport failure. */
export function isDirectoryKeyMiss(err: unknown): boolean {
  const status = Number((err as { status?: number } | null)?.status);
  if (status === 404) return true;
  const code = String((err as { code?: string } | null)?.code || "").toLowerCase();
  if (
    code === "not_found" ||
    code === "capability_mismatch" ||
    code === "principal_not_found" ||
    code === "no_key"
  ) {
    return true;
  }
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    message.includes("404") ||
    message.includes("not found") ||
    message.includes("no mutually supported") ||
    message.includes("capability_mismatch")
  );
}

export function decideSendGate(input: {
  bodyProtected: boolean;
  encrypt: boolean;
  sign: boolean;
  recipients: RecipientDirectoryStatus[];
  /** Verified `pgp` add-on. Without it, do not force encrypt; paid actions still block. */
  pgpEntitled: boolean;
}): { allow: boolean; needsProtect: boolean; errorMessage?: string } {
  const { bodyProtected, encrypt, sign, recipients, pgpEntitled } = input;
  const pgpEncryptable = recipients.filter((row) => row.addInCanEncrypt);

  if (bodyProtected) {
    return { allow: true, needsProtect: false };
  }

  if (!pgpEntitled && (encrypt || sign)) {
    return {
      allow: false,
      needsProtect: false,
      errorMessage:
        'OpenPGP encrypt and sign require the "pgp" add-on. Sync Account & Billing, then try again.',
    };
  }

  if (!pgpEntitled) {
    return { allow: true, needsProtect: false };
  }

  if (pgpEncryptable.length > 0 && !encrypt) {
    return {
      allow: false,
      needsProtect: false,
      errorMessage:
        `${pgpEncryptable.map((row) => row.email).join(", ")} ` +
        "have published OpenPGP keys. Click Encrypt on the Scomm.AI ribbon, or change recipients.",
    };
  }

  if (encrypt) {
    const missing = recipients.filter((row) => row.status === "missing");
    if (missing.length > 0) {
      return {
        allow: false,
        needsProtect: false,
        errorMessage:
          `${missing.map((row) => row.email).join(", ")} ` +
          "have no OpenPGP key on the pubkey directory. Publish a key from the Security pane for your mailbox, or remove recipients without keys.",
      };
    }
    const lookupErrors = recipients.filter((row) => row.status === "error");
    if (lookupErrors.length > 0) {
      const first = lookupErrors[0]!;
      return {
        allow: false,
        needsProtect: false,
        errorMessage: `Could not look up an encryption key for ${first.email}. ${first.hint}`,
      };
    }
    const blocked = recipients.filter((row) => !row.addInCanEncrypt);
    if (blocked.length > 0) {
      const first = blocked[0]!;
      return {
        allow: false,
        needsProtect: false,
        errorMessage:
          `${first.email} cannot be encrypted from this add-in. ${first.hint}`,
      };
    }
  }

  return {
    allow: true,
    needsProtect: encrypt || sign,
  };
}
