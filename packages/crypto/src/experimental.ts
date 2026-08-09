import { UnsupportedFeatureError } from "@scomm-office/core";
import type {
  DecryptedMessage,
  EncryptableMessage,
  EncryptedMessage,
  MessageDecryptor,
  MessageEncryptor,
  RecipientKeySet,
} from "./message-crypto.js";

const E2EE_SPEC = "openspec/security/e2ee-protocol.md";

export class ExperimentalMessageEncryptor implements MessageEncryptor {
  async encrypt(
    _message: EncryptableMessage,
    _recipients: RecipientKeySet[],
  ): Promise<EncryptedMessage> {
    throw new UnsupportedFeatureError(
      `SComm E2EE protocol has not yet been finalized. See ${E2EE_SPEC}`,
    );
  }
}

export class ExperimentalMessageDecryptor implements MessageDecryptor {
  async decrypt(_message: EncryptedMessage): Promise<DecryptedMessage> {
    throw new UnsupportedFeatureError(
      `SComm E2EE protocol has not yet been finalized. See ${E2EE_SPEC}`,
    );
  }
}
