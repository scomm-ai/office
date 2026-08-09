import type { PublicKeyRecord } from "@scomm-office/protocol";

const INACTIVE_STATES = new Set(["revoked", "expired", "superseded"]);

export function isUsableKey(record: PublicKeyRecord, now = Date.now()): boolean {
  if (record.state && INACTIVE_STATES.has(record.state)) {
    return false;
  }
  if (record.expiresAt) {
    const expiresAt = Date.parse(record.expiresAt);
    if (!Number.isNaN(expiresAt) && expiresAt <= now) {
      return false;
    }
  }
  return true;
}

export function filterUsableKeys(
  records: PublicKeyRecord[],
  now = Date.now(),
): PublicKeyRecord[] {
  return records.filter((record) => isUsableKey(record, now));
}
