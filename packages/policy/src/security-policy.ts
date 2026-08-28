import type { ProtectionMode as CryptoProtectionMode } from "@scomm-office/crypto";
import { CryptoFamily } from "@scomm-office/crypto";
import type { NegotiationPolicy, NegotiationResult } from "@scomm-office/capability-negotiation";

export type ProtectionMode = CryptoProtectionMode;

export type SigningPolicy =
  | "sign-all"
  | "sign-external"
  | "sign-internal"
  | "manual"
  | "require-for-recipient";

export type EncryptionPolicy =
  | "manual"
  | "encrypt-when-all-have-keys"
  | "require-for-recipient"
  | "never-downgrade";

export interface SecurityPolicyConfig {
  signing: SigningPolicy;
  encryption: EncryptionPolicy;
  negotiation: NegotiationPolicy;
  protocol: "automatic" | CryptoFamily;
  requireSemanticSignature?: boolean;
  prohibitExplicitDowngrade?: boolean;
}

export interface SendSecurityRequest {
  sign: boolean;
  encrypt: boolean;
  protocol: "automatic" | CryptoFamily;
}

export interface SendSecurityDecision {
  allowed: boolean;
  mode: ProtectionMode;
  family: CryptoFamily | null;
  negotiation: NegotiationResult;
  blockedReason?: string;
  warnings: string[];
}

export function evaluateSendSecurity(
  request: SendSecurityRequest,
  policy: SecurityPolicyConfig,
  negotiation: NegotiationResult,
): SendSecurityDecision {
  const warnings: string[] = [];
  let mode: ProtectionMode = "none";
  if (request.sign && request.encrypt) mode = "signAndEncrypt";
  else if (request.sign) mode = "sign";
  else if (request.encrypt) mode = "encrypt";

  if (policy.signing === "sign-all" && !request.sign) {
    warnings.push("Policy recommends signing all outgoing email");
  }

  if (request.encrypt && negotiation.blocked) {
    return {
      allowed: policy.encryption !== "never-downgrade" && policy.negotiation.allowExplicitDowngrade === true
        ? false
        : false,
      mode,
      family: null,
      negotiation,
      blockedReason: negotiation.reason ?? "Encryption unavailable",
      warnings,
    };
  }

  let family: CryptoFamily | null = negotiation.selectedFamily;
  if (request.protocol !== "automatic") {
    family = request.protocol;
    if (family && !negotiation.commonFamilies.includes(family)) {
      return {
        allowed: false,
        mode,
        family,
        negotiation,
        blockedReason: `Protocol ${family} not compatible with all recipients`,
        warnings,
      };
    }
  }

  if (request.encrypt && negotiation.missingEncryption.length > 0) {
    return {
      allowed: false,
      mode,
      family,
      negotiation,
      blockedReason: `Encryption unavailable for: ${negotiation.missingEncryption.join(", ")}`,
      warnings,
    };
  }

  return { allowed: true, mode, family, negotiation, warnings };
}
