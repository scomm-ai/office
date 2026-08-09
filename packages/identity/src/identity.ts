import { normalizeEmailIdentity, type NormalizedEmailIdentity } from "@scomm-office/core";
import type { IdentityType } from "@scomm-office/protocol";

export interface EmailScommIdentity {
  type: "email";
  value: string;
  normalized: NormalizedEmailIdentity;
}

export interface ScommUidIdentity {
  type: "scomm-uid";
  value: string;
}

export interface OtherScommIdentity {
  type: "other";
  value: string;
  label?: string;
}

export type ScommIdentity = EmailScommIdentity | ScommUidIdentity | OtherScommIdentity;

export function createEmailIdentity(value: string): EmailScommIdentity {
  return {
    type: "email",
    value: value.trim(),
    normalized: normalizeEmailIdentity(value),
  };
}

export function createScommUidIdentity(value: string): ScommUidIdentity {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("SComm UID identity value must not be empty");
  }
  return { type: "scomm-uid", value: trimmed };
}

export function createOtherIdentity(value: string, label?: string): OtherScommIdentity {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Other identity value must not be empty");
  }
  return label !== undefined ? { type: "other", value: trimmed, label } : { type: "other", value: trimmed };
}

export function parseIdentity(type: IdentityType, value: string): ScommIdentity {
  switch (type) {
    case "email":
      return createEmailIdentity(value);
    case "scomm-uid":
      return createScommUidIdentity(value);
    case "other":
      return createOtherIdentity(value);
  }
}

export function identityComparisonKey(identity: ScommIdentity): string {
  switch (identity.type) {
    case "email":
      return identity.normalized.comparisonKey;
    case "scomm-uid":
      return `scomm-uid:${identity.value}`;
    case "other":
      return `other:${identity.value}`;
  }
}

export function identitiesEqual(a: ScommIdentity, b: ScommIdentity): boolean {
  if (a.type !== b.type) {
    return false;
  }
  return identityComparisonKey(a) === identityComparisonKey(b);
}

export function identityToProtocolIdentity(identity: ScommIdentity): {
  type: IdentityType;
  value: string;
} {
  return { type: identity.type, value: identity.value };
}
