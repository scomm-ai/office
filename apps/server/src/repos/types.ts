import type { PublicKeyRecord } from "@scomm-office/protocol";
import type { UserConfiguration } from "@scomm-office/protocol";
import type { SemanticMailDocument } from "@scomm-office/semantics";
import type { PolicyRule } from "@scomm-office/policy";

export interface PublicKeyRepository {
  listKeys(identityType: string, identityValue: string): Promise<PublicKeyRecord[]>;
  getKey(
    identityType: string,
    identityValue: string,
    keyId: string,
  ): Promise<PublicKeyRecord | null>;
  upsertKey(record: PublicKeyRecord): Promise<PublicKeyRecord>;
  revokeKey(
    identityType: string,
    identityValue: string,
    keyId: string,
    reason?: string,
  ): Promise<PublicKeyRecord | null>;
}

export interface AuditEventRow {
  id: number;
  event: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AuditRepository {
  append(event: string, payload: Record<string, unknown>): Promise<void>;
  listRecent(limit?: number): Promise<AuditEventRow[]>;
}

export interface SemanticRepository {
  save(id: string, document: SemanticMailDocument, digest: string): Promise<void>;
  findById(id: string): Promise<SemanticMailDocument | null>;
}

export interface PolicyRepository {
  listRules(): PolicyRule[];
}

export interface UserConfigurationRepository {
  get(userId: string): Promise<UserConfiguration | null>;
  save(userId: string, config: UserConfiguration): Promise<void>;
}

export interface Repositories {
  publicKeys: PublicKeyRepository;
  audit: AuditRepository;
  semantics: SemanticRepository;
  policy: PolicyRepository;
  userConfigurations: UserConfigurationRepository;
}
