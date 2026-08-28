import {
  CryptoFamily,
  CryptoErrorCodes,
  ScommCryptoError,
  type CryptoOperationContext,
  type CryptoProvider,
  type DecryptionKeyHandle,
  type ProtectedMessage,
  type PublicKeyMaterial,
  type VerificationState,
} from "@scomm-office/crypto";
import type { LogicalMessage } from "@scomm-office/message-core";

/**
 * S/MIME provider abstraction. CMS operations require platform trust stores
 * (Windows CAPI, macOS Keychain). JS hosts use fail-closed stubs until
 * native bridge is available.
 */
export class SmimeCryptoProvider implements CryptoProvider {
  readonly family = CryptoFamily.SMIME;

  sign(_context: CryptoOperationContext): Promise<ProtectedMessage> {
    return Promise.reject(this.createError());
  }

  encrypt(_context: CryptoOperationContext): Promise<ProtectedMessage> {
    return Promise.reject(this.createError());
  }

  signAndEncrypt(_context: CryptoOperationContext): Promise<ProtectedMessage> {
    return Promise.reject(this.createError());
  }

  verify(_mime: Uint8Array, _publicKeys: PublicKeyMaterial[]): Promise<VerificationState> {
    return Promise.reject(this.createError());
  }

  decrypt(
    _mime: Uint8Array,
    _decryptionKey: DecryptionKeyHandle,
  ): Promise<{ plaintext: Uint8Array; verification?: VerificationState }> {
    return Promise.reject(this.createError());
  }

  decryptAndVerify(
    _mime: Uint8Array,
    _decryptionKey: DecryptionKeyHandle,
    _publicKeys: PublicKeyMaterial[],
  ): Promise<{ message: LogicalMessage; verification: VerificationState }> {
    return Promise.reject(this.createError());
  }

  private createError(): ScommCryptoError {
    return new ScommCryptoError(
      CryptoErrorCodes.UnsupportedMimeStructure,
      "S/MIME CMS operations require a platform-native crypto bridge; not available in this JS host",
    );
  }
}

export function createSmimeProvider(): SmimeCryptoProvider {
  return new SmimeCryptoProvider();
}
