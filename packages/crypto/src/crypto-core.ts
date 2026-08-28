import type { CryptoProvider, CryptoFamily, ProtectedMessage } from "./types.js";
import { CryptoFamily as CF } from "./types.js";

export class CryptoCore {
  private readonly providers = new Map<CryptoFamily, CryptoProvider>();

  registerProvider(provider: CryptoProvider): void {
    this.providers.set(provider.family, provider);
  }

  getProvider(family: CryptoFamily): CryptoProvider | undefined {
    return this.providers.get(family);
  }

  availableFamilies(): CryptoFamily[] {
    return [...this.providers.keys()];
  }
}

export function familyFromWire(wire: string): CryptoFamily | null {
  const normalized = wire.toLowerCase();
  if (normalized === "pgp" || normalized === "openpgp") return CF.OpenPGP;
  if (normalized === "smime" || normalized === "s/mime") return CF.SMIME;
  return null;
}

export interface InspectOptions {
  semanticVerify?: boolean;
}

/** High-level inspection orchestrator — delegates to registered providers. */
export function detectProtectionKind(mime: Uint8Array): string {
  const text = new TextDecoder("latin1").decode(mime);
  if (text.includes('protocol="application/pgp-signature"')) return "openpgp-signed";
  if (text.includes('protocol="application/pgp-encrypted"')) return "openpgp-encrypted";
  if (text.includes("application/pkcs7-signature")) return "smime-signed";
  if (text.includes("application/pkcs7-mime")) return "smime-encrypted";
  if (text.includes("application/vnd.scomm.manifest+json")) return "semantic-signed";
  if (text.includes("-----BEGIN PGP MESSAGE-----")) return "openpgp-encrypted";
  return "unsigned";
}

export type { ProtectedMessage };
