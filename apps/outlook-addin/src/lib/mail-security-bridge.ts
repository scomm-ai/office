import { CryptoFamily } from "@scomm-office/crypto";
import {
  OpenPgpPrivateKeyHandle,
  publicKeyMaterialFromBytes,
} from "@scomm-office/crypto-openpgp";
import {
  wireFamiliesToCrypto,
  type RecipientCapabilities,
} from "@scomm-office/capability-negotiation";
import { MailSecurityService, type ProtectMessageInput } from "@scomm-office/mail-security";
import type { ComposeSnapshot } from "@scomm-office/message-core";
import type { SecurityPolicyConfig, SendSecurityRequest } from "@scomm-office/policy";
import { decodePublicMaterial, normalizeEmail } from "@scomm-office/pubkeys";
import { vaultPgpPrivateKeys, type OfficePubkeySession } from "./pubkey-session.js";

export const defaultSecurityPolicy: SecurityPolicyConfig = {
  signing: "manual",
  encryption: "encrypt-when-all-have-keys",
  protocol: "automatic",
  negotiation: {
    neverDowngradeEncryption: true,
    allowExplicitDowngrade: false,
  },
};

let serviceInstance: MailSecurityService | null = null;

export function getMailSecurityService(): MailSecurityService {
  serviceInstance ??= new MailSecurityService();
  return serviceInstance;
}

export interface ComposeSecurityOptions {
  sign: boolean;
  encrypt: boolean;
  protocol: "automatic" | CryptoFamily;
}

export async function protectComposeSnapshot(
  session: OfficePubkeySession,
  snapshot: ComposeSnapshot,
  userEmail: string,
  options: ComposeSecurityOptions,
  policy: SecurityPolicyConfig = defaultSecurityPolicy,
) {
  const service = getMailSecurityService();
  const recipientAddresses = [
    ...(snapshot.to ?? []),
    ...(snapshot.cc ?? []),
    ...(snapshot.bcc ?? []),
  ].map((a) => normalizeEmail(a.emailAddress));

  const emails = [...new Set([...recipientAddresses, normalizeEmail(userEmail)])];
  const recipients: RecipientCapabilities[] = [];
  const recipientKeys = [];

  for (const email of emails) {
    try {
      const encKey = (await session.client.getBestKey({
        email,
        purpose: "encryption",
      })) as { family?: string; public_material?: string; locator?: string } | null;
      const signKey = (await session.client.getBestKey({
        email,
        purpose: "signing",
      })) as { family?: string } | null;
      const wireFamily = encKey?.family ?? signKey?.family ?? "pgp";
      const families = wireFamiliesToCrypto([wireFamily]);
      recipients.push({
        identity: email,
        families: families.length ? families : [CryptoFamily.OpenPGP],
        canEncrypt: Boolean(encKey?.public_material),
        canSign: Boolean(signKey),
      });
      if (encKey?.public_material) {
        recipientKeys.push(
          publicKeyMaterialFromBytes(
            email,
            decodePublicMaterial(String(encKey.public_material)),
            String(encKey.locator ?? email),
            { canSign: Boolean(signKey), canEncrypt: true },
          ),
        );
      }
    } catch {
      recipients.push({
        identity: email,
        families: [CryptoFamily.OpenPGP],
        canEncrypt: false,
        canSign: false,
      });
    }
  }

  const signingKey = createSigningHandle(session, userEmail);
  const request: SendSecurityRequest = {
    sign: options.sign,
    encrypt: options.encrypt,
    protocol: options.protocol,
  };

  const input: ProtectMessageInput = {
    snapshot,
    request,
    policy,
    senderFamilies: [CryptoFamily.OpenPGP],
    recipients,
    recipientKeys,
    signingKey: signingKey ?? undefined,
    includeSenderForEncryption: options.encrypt,
    senderEmail: userEmail,
    signingKeyId: signingKey ? (await signingKey.getPublicMetadata()).shortKeyId : "",
  };

  return service.protectMessage(input);
}

function createSigningHandle(
  session: OfficePubkeySession,
  userEmail: string,
): OpenPgpPrivateKeyHandle | null {
  const keys = vaultPgpPrivateKeys(session);
  if (keys.length === 0) return null;
  return new OpenPgpPrivateKeyHandle(
    {
      family: CryptoFamily.OpenPGP,
      identity: userEmail,
      fingerprint: "local-vault",
      shortKeyId: "local",
      algorithm: "openpgp-cv25519",
      canSign: true,
      canEncrypt: true,
    },
    keys[0]!,
    new Uint8Array(),
  );
}
