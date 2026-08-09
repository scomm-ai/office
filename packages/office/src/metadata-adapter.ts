import {
  X_SCOMM_CLASSIFICATION,
  X_SCOMM_MESSAGE_UID,
  X_SCOMM_SCHEMA,
  X_SCOMM_SECURITY,
  X_SCOMM_SEMANTIC_DIGEST,
  X_SCOMM_SEMANTICS,
  X_SCOMM_VERSION,
  scommMessageMetadataSchema,
  type ScommMessageMetadata,
} from "@scomm-office/protocol";
import type { MailHost } from "./mail-host.js";

export const SCOMM_HEADER_TO_FIELD = {
  [X_SCOMM_VERSION]: "version",
  [X_SCOMM_MESSAGE_UID]: "messageUid",
  [X_SCOMM_SCHEMA]: "schema",
  [X_SCOMM_SEMANTICS]: "semantics",
  [X_SCOMM_SEMANTIC_DIGEST]: "semanticDigest",
  [X_SCOMM_CLASSIFICATION]: "classification",
  [X_SCOMM_SECURITY]: "security",
} as const satisfies Record<string, keyof ScommMessageMetadata>;

const FIELD_TO_HEADER: Record<keyof ScommMessageMetadata, string> = {
  version: X_SCOMM_VERSION,
  messageUid: X_SCOMM_MESSAGE_UID,
  schema: X_SCOMM_SCHEMA,
  semantics: X_SCOMM_SEMANTICS,
  semanticDigest: X_SCOMM_SEMANTIC_DIGEST,
  classification: X_SCOMM_CLASSIFICATION,
  security: X_SCOMM_SECURITY,
};

function headersToMetadata(headers: Record<string, string>): ScommMessageMetadata | null {
  const raw: Record<string, string> = {};

  for (const [headerName, fieldName] of Object.entries(SCOMM_HEADER_TO_FIELD)) {
    const value = headers[headerName];
    if (value !== undefined) {
      raw[fieldName] = value;
    }
  }

  if (!raw.version) {
    return null;
  }

  return scommMessageMetadataSchema.parse(raw);
}

function metadataToHeaders(metadata: ScommMessageMetadata): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [fieldName, headerName] of Object.entries(FIELD_TO_HEADER)) {
    const value = metadata[fieldName as keyof ScommMessageMetadata];
    if (value !== undefined && value !== "") {
      headers[headerName] = value;
    }
  }

  return headers;
}

export class ScommMessageMetadataAdapter {
  constructor(private readonly mailHost: MailHost) {}

  async read(): Promise<ScommMessageMetadata | null> {
    const headers = await this.mailHost.getHeaders();
    return headersToMetadata(headers);
  }

  async write(metadata: ScommMessageMetadata): Promise<void> {
    const parsed = scommMessageMetadataSchema.parse(metadata);
    const headers = metadataToHeaders(parsed);
    await this.mailHost.setHeaders(headers);
  }
}
