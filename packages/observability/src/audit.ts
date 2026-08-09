export type AuditEventType =
  | "semantic.analysis"
  | "policy.evaluation"
  | "message.blocked"
  | "message.warning"
  | "pubkey.lookup"
  | "pubkey.publish"
  | "idr.connect"
  | "idr.disconnect"
  | "ai.request"
  | "encryption.request"
  | "decryption.request";

export interface AuditEventBase {
  type: AuditEventType;
  timestamp: string;
  correlationId?: string;
}

export interface SemanticAnalysisAuditEvent extends AuditEventBase {
  type: "semantic.analysis";
  segmentCount?: number;
  durationMs?: number;
}

export interface PolicyEvaluationAuditEvent extends AuditEventBase {
  type: "policy.evaluation";
  allowed: boolean;
  findingCount?: number;
  durationMs?: number;
}

export interface MessageBlockedAuditEvent extends AuditEventBase {
  type: "message.blocked";
  reason?: string;
}

export interface MessageWarningAuditEvent extends AuditEventBase {
  type: "message.warning";
  reason?: string;
}

export interface PubkeyLookupAuditEvent extends AuditEventBase {
  type: "pubkey.lookup";
  identityType?: string;
  resultCount?: number;
  durationMs?: number;
}

export interface PubkeyPublishAuditEvent extends AuditEventBase {
  type: "pubkey.publish";
  identityType?: string;
  keyId?: string;
}

export interface IdrConnectAuditEvent extends AuditEventBase {
  type: "idr.connect";
  targetHost?: string;
  service?: string;
  durationMs?: number;
}

export interface IdrDisconnectAuditEvent extends AuditEventBase {
  type: "idr.disconnect";
  targetHost?: string;
  service?: string;
}

export interface AiRequestAuditEvent extends AuditEventBase {
  type: "ai.request";
  provider?: string;
  action?: string;
  durationMs?: number;
}

export interface EncryptionRequestAuditEvent extends AuditEventBase {
  type: "encryption.request";
  recipientCount?: number;
}

export interface DecryptionRequestAuditEvent extends AuditEventBase {
  type: "decryption.request";
}

export type AuditEvent =
  | SemanticAnalysisAuditEvent
  | PolicyEvaluationAuditEvent
  | MessageBlockedAuditEvent
  | MessageWarningAuditEvent
  | PubkeyLookupAuditEvent
  | PubkeyPublishAuditEvent
  | IdrConnectAuditEvent
  | IdrDisconnectAuditEvent
  | AiRequestAuditEvent
  | EncryptionRequestAuditEvent
  | DecryptionRequestAuditEvent;
