import type { PublicKeyRecord } from "@scomm-office/protocol";
import type { ScommIdentity } from "@scomm-office/identity";

export interface PublicKeyDirectory {
  getKeys(identity: ScommIdentity): Promise<PublicKeyRecord[]>;
  setKey(record: PublicKeyRecord): Promise<PublicKeyRecord>;
  revokeKey?(identity: ScommIdentity, keyId: string, reason?: string): Promise<void>;
}
