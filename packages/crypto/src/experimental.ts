import { UnsupportedFeatureError } from "@scomm-office/core";
import type {
  DecryptedMessage,
  EncryptableMessage,
  EncryptedMessage,
  MessageDecryptor,
  MessageEncryptor,
  RecipientKeySet,
} from "./message-crypto.js";

/**
 * Legacy encryptor interface. Default Outlook mail E2EE is inline OpenPGP via
 * `@scomm/pubkey` PgpEngine. The experimental ECDH envelope lives in
 * `ScommMessageEncryptor` (Settings: Experimental ECDH envelope).
 */
export class ExperimentalMessageEncryptor implements MessageEncryptor {
  async encrypt(
    _message: EncryptableMessage,
    _recipients: RecipientKeySet[],
  ): Promise<EncryptedMessage> {
    throw new UnsupportedFeatureError(
      "Mail encrypt uses OpenPGP (PgpEngine). There is no SComm-proprietary envelope.",
    );
  }
}

export class ExperimentalMessageDecryptor implements MessageDecryptor {
  async decrypt(_message: EncryptedMessage): Promise<DecryptedMessage> {
    throw new UnsupportedFeatureError(
      "Mail decrypt uses OpenPGP (PgpEngine). There is no SComm-proprietary envelope.",
    );
  }
}
