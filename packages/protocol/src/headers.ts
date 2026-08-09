/** SComm-aware Internet header names. See openspec/features/scomm-message-headers.md */

export const X_SCOMM_VERSION = "X-SComm-Version" as const;
export const X_SCOMM_MESSAGE_UID = "X-SComm-Message-UID" as const;
export const X_SCOMM_SCHEMA = "X-SComm-Schema" as const;
export const X_SCOMM_SEMANTICS = "X-SComm-Semantics" as const;
export const X_SCOMM_SEMANTIC_DIGEST = "X-SComm-Semantic-Digest" as const;
export const X_SCOMM_CLASSIFICATION = "X-SComm-Classification" as const;
export const X_SCOMM_SECURITY = "X-SComm-Security" as const;

export const SCOMM_HEADER_NAMES = [
  X_SCOMM_VERSION,
  X_SCOMM_MESSAGE_UID,
  X_SCOMM_SCHEMA,
  X_SCOMM_SEMANTICS,
  X_SCOMM_SEMANTIC_DIGEST,
  X_SCOMM_CLASSIFICATION,
  X_SCOMM_SECURITY,
] as const;

export type ScommHeaderName = (typeof SCOMM_HEADER_NAMES)[number];
