import { CryptoFamily, CryptoErrorCodes, ScommCryptoError } from "@scomm-office/crypto";
import { familyFromWire } from "@scomm-office/crypto";

export interface RecipientCapabilities {
  identity: string;
  families: CryptoFamily[];
  canSign: boolean;
  canEncrypt: boolean;
  preference?: CryptoFamily;
}

export interface NegotiationPolicy {
  preferOpenPgp?: boolean;
  preferSmime?: boolean;
  preferSmimeInternally?: boolean;
  preferOpenPgpExternally?: boolean;
  requireEncryption?: boolean;
  neverDowngradeEncryption?: boolean;
  allowExplicitDowngrade?: boolean;
  internalDomains?: string[];
}

export interface NegotiationResult {
  selectedFamily: CryptoFamily | null;
  commonFamilies: CryptoFamily[];
  compatibleRecipients: number;
  totalRecipients: number;
  missingEncryption: string[];
  blocked: boolean;
  reason?: string;
  resolvedProtocol: string;
}

function isInternal(email: string, domains: string[]): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return domains.some((d) => domain === d.toLowerCase() || domain?.endsWith(`.${d.toLowerCase()}`));
}

export function negotiateCryptoFamily(
  senderFamilies: CryptoFamily[],
  recipients: RecipientCapabilities[],
  policy: NegotiationPolicy = {},
): NegotiationResult {
  const totalRecipients = recipients.length;
  if (totalRecipients === 0) {
    return {
      selectedFamily: senderFamilies[0] ?? null,
      commonFamilies: senderFamilies,
      compatibleRecipients: 0,
      totalRecipients: 0,
      missingEncryption: [],
      blocked: false,
      resolvedProtocol: senderFamilies[0] ?? "none",
    };
  }

  let common = new Set(senderFamilies);
  for (const recipient of recipients) {
    const recipientSet = new Set(recipient.families);
    common = new Set([...common].filter((f) => recipientSet.has(f)));
  }
  const commonFamilies = [...common];

  const missingEncryption = recipients
    .filter((r) => !r.canEncrypt)
    .map((r) => r.identity);

  if (policy.requireEncryption && missingEncryption.length > 0) {
    if (policy.neverDowngradeEncryption || !policy.allowExplicitDowngrade) {
      return {
        selectedFamily: null,
        commonFamilies,
        compatibleRecipients: totalRecipients - missingEncryption.length,
        totalRecipients,
        missingEncryption,
        blocked: true,
        reason: "Encryption required but not all recipients have compatible keys",
        resolvedProtocol: "blocked",
      };
    }
  }

  if (commonFamilies.length === 0) {
    return {
      selectedFamily: null,
      commonFamilies: [],
      compatibleRecipients: 0,
      totalRecipients,
      missingEncryption,
      blocked: true,
      reason: "No compatible crypto family among sender and recipients",
      resolvedProtocol: "none",
    };
  }

  let selected = commonFamilies[0]!;
  if (policy.preferOpenPgp && commonFamilies.includes(CryptoFamily.OpenPGP)) {
    selected = CryptoFamily.OpenPGP;
  } else if (policy.preferSmime && commonFamilies.includes(CryptoFamily.SMIME)) {
    selected = CryptoFamily.SMIME;
  } else if (policy.internalDomains?.length && recipients.length > 0) {
    const allInternal = recipients.every((r) => isInternal(r.identity, policy.internalDomains!));
    const allExternal = recipients.every((r) => !isInternal(r.identity, policy.internalDomains!));
    if (allInternal && policy.preferSmimeInternally && commonFamilies.includes(CryptoFamily.SMIME)) {
      selected = CryptoFamily.SMIME;
    }
    if (allExternal && policy.preferOpenPgpExternally && commonFamilies.includes(CryptoFamily.OpenPGP)) {
      selected = CryptoFamily.OpenPGP;
    }
  }

  const preferred = recipients.find((r) => r.preference)?.preference;
  if (preferred && commonFamilies.includes(preferred)) {
    selected = preferred;
  }

  return {
    selectedFamily: selected,
    commonFamilies,
    compatibleRecipients: totalRecipients - missingEncryption.length,
    totalRecipients,
    missingEncryption,
    blocked: false,
    resolvedProtocol: selected,
  };
}

export function wireFamiliesToCrypto(families: string[]): CryptoFamily[] {
  const out: CryptoFamily[] = [];
  for (const f of families) {
    const mapped = familyFromWire(f);
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

export function assertNoSilentDowngrade(
  requestedEncryption: boolean,
  result: NegotiationResult,
): void {
  if (!requestedEncryption) return;
  if (result.blocked || !result.selectedFamily) {
    throw new ScommCryptoError(
      CryptoErrorCodes.EncryptionDowngradeBlocked,
      result.reason ?? "Encryption unavailable",
      { missing: result.missingEncryption },
    );
  }
}
