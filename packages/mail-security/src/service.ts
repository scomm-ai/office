import {
  CryptoCore,
  CryptoFamily,
  MemoryPublicKeyCache,
  detectProtectionKind,
  type KeyVault,
  type MessageSubmissionAdapter,
  type ProtectedMessage,
  type PublicKeyMaterial,
  type SigningKeyHandle,
} from "@scomm-office/crypto";
import { OpenPgpCryptoProvider } from "@scomm-office/crypto-openpgp";
import { createSmimeProvider } from "@scomm-office/crypto-smime";
import {
  assertNoSilentDowngrade,
  negotiateCryptoFamily,
  type RecipientCapabilities,
} from "@scomm-office/capability-negotiation";
import { captureComposeSnapshot, type ComposeSnapshot } from "@scomm-office/message-core";
import { detectMimeStructure } from "@scomm-office/mime";
import {
  evaluateSendSecurity,
  type SecurityPolicyConfig,
  type SendSecurityRequest,
} from "@scomm-office/policy";
import {
  buildSemanticManifest,
  signManifest,
  verifySemanticManifest,
  type SemanticVerificationResult,
} from "@scomm-office/semantic-signatures";
import { createLogger } from "@scomm-office/observability";

const log = createLogger("mail-security");

export interface ProtectMessageInput {
  snapshot: ComposeSnapshot;
  request: SendSecurityRequest;
  policy: SecurityPolicyConfig;
  senderFamilies: CryptoFamily[];
  recipients: RecipientCapabilities[];
  recipientKeys: PublicKeyMaterial[];
  signingKey?: SigningKeyHandle;
  senderEncryptionKey?: PublicKeyMaterial;
  includeSenderForEncryption?: boolean;
  signSemantic?: boolean;
  semanticSignFn?: (payload: Uint8Array) => Promise<Uint8Array>;
  senderEmail: string;
  signingKeyId: string;
}

export interface ProtectMessageResult {
  decision: ReturnType<typeof evaluateSendSecurity>;
  protectedMessage?: ProtectedMessage;
  semantic?: SemanticVerificationResult;
}

export interface InspectMessageResult {
  protectionKind: string;
  mimeStructure: string;
  semantic?: SemanticVerificationResult;
}

export class MailSecurityService {
  private readonly crypto = new CryptoCore();
  readonly keyCache = new MemoryPublicKeyCache();

  constructor() {
    this.crypto.registerProvider(new OpenPgpCryptoProvider());
    this.crypto.registerProvider(createSmimeProvider());
  }

  async protectMessage(input: ProtectMessageInput): Promise<ProtectMessageResult> {
    const negotiation = negotiateCryptoFamily(
      input.senderFamilies,
      input.recipients,
      input.policy.negotiation,
    );

    if (input.request.encrypt) {
      assertNoSilentDowngrade(true, negotiation);
    }

    const decision = evaluateSendSecurity(input.request, input.policy, negotiation);
    if (!decision.allowed || !decision.family) {
      log.info("send blocked", {
        operation: "protect",
        reason: decision.blockedReason,
        recipientCount: input.recipients.length,
      });
      return { decision };
    }

    const provider = this.crypto.getProvider(decision.family);
    if (!provider) {
      return {
        decision: {
          ...decision,
          allowed: false,
          blockedReason: `Provider for ${decision.family} unavailable`,
        },
      };
    }

    const context = {
      message: input.snapshot,
      recipientKeys: input.recipientKeys,
      senderSigningKey: input.signingKey,
      senderEncryptionKey: input.senderEncryptionKey,
      includeSenderForEncryption: input.includeSenderForEncryption,
    };

    let protectedMessage: ProtectedMessage;
    switch (decision.mode) {
      case "sign":
        protectedMessage = await provider.sign(context);
        break;
      case "encrypt":
        protectedMessage = await provider.encrypt(context);
        break;
      case "signAndEncrypt":
        protectedMessage = await provider.signAndEncrypt(context);
        break;
      default:
        return { decision };
    }

    log.info("message protected", {
      operation: "protect",
      family: decision.family,
      mode: decision.mode,
      recipientCount: input.recipients.length,
      result: "ok",
    });

    return { decision, protectedMessage };
  }

  inspectMime(mime: Uint8Array): InspectMessageResult {
    const structure = detectMimeStructure(mime);
    return {
      protectionKind: detectProtectionKind(mime),
      mimeStructure: structure.kind,
    };
  }

  createSnapshotFromCompose(source: Parameters<typeof captureComposeSnapshot>[0]): ComposeSnapshot {
    return captureComposeSnapshot(source);
  }
}

export interface SubmitProtectedMessageInput {
  protectedMessage: ProtectedMessage;
  adapter: MessageSubmissionAdapter;
  headers?: Record<string, string>;
}

export async function submitProtectedMessage(input: SubmitProtectedMessageInput): Promise<void> {
  await input.adapter.submit(input.protectedMessage, input.headers);
}

export {
  buildSemanticManifest,
  signManifest,
  verifySemanticManifest,
  type SemanticVerificationResult,
};
