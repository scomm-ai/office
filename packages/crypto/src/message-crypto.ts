export interface EncryptableMessage {
  subject?: string;
  body: string;
  headers?: Record<string, string>;
  attachments?: Array<{ name: string; contentType: string; data: ArrayBuffer }>;
}

export interface RecipientKeySet {
  identity: string;
  keyId: string;
  publicKey: string;
  algorithm: string;
}

export interface EncryptedMessage {
  envelopeVersion: number;
  ciphertext: string;
  recipients: RecipientKeySet[];
  metadata?: Record<string, unknown>;
}

export interface DecryptedMessage {
  subject?: string;
  body: string;
  headers?: Record<string, string>;
}

export interface MessageEncryptor {
  encrypt(
    message: EncryptableMessage,
    recipients: RecipientKeySet[],
  ): Promise<EncryptedMessage>;
}

export interface MessageDecryptor {
  decrypt(message: EncryptedMessage): Promise<DecryptedMessage>;
}
