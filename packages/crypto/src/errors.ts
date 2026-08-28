export class ScommCryptoError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ScommCryptoError";
  }
}

export const CryptoErrorCodes = {
  NoCompatibleCryptoFamily: "NoCompatibleCryptoFamily",
  MissingRecipientKey: "MissingRecipientKey",
  SigningKeyUnavailable: "SigningKeyUnavailable",
  EncryptionKeyUnavailable: "EncryptionKeyUnavailable",
  PrivateKeyLocked: "PrivateKeyLocked",
  InvalidSignature: "InvalidSignature",
  IdentityBindingFailure: "IdentityBindingFailure",
  UntrustedCertificate: "UntrustedCertificate",
  RevokedKey: "RevokedKey",
  MalformedMime: "MalformedMime",
  UnsupportedMimeStructure: "UnsupportedMimeStructure",
  SemanticManifestMismatch: "SemanticManifestMismatch",
  AttachmentDigestMismatch: "AttachmentDigestMismatch",
  HtmlSemanticMismatch: "HtmlSemanticMismatch",
  PolicyViolation: "PolicyViolation",
  SubmissionFailure: "SubmissionFailure",
  EncryptionDowngradeBlocked: "EncryptionDowngradeBlocked",
} as const;

export type CryptoErrorCode = (typeof CryptoErrorCodes)[keyof typeof CryptoErrorCodes];

export function isScommCryptoError(err: unknown): err is ScommCryptoError {
  return err instanceof ScommCryptoError;
}
