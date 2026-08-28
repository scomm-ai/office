import { canonicalizeJson } from "./jcs.js";
import {
  canonicalizationProfile,
  canonicalizeAuthoredText,
  normalizeRecipients,
  recipientEmails,
  type LogicalAttachment,
  type LogicalMessage,
} from "@scomm-office/message-core";

export const MANIFEST_MIME = "application/vnd.scomm.manifest+json";
export const SIGNATURE_MIME = "application/vnd.scomm.signature";

export interface AttachmentDigest {
  filename: string;
  media_type: string;
  size: number;
  sha256: string;
}

export interface SemanticManifestV1 {
  version: 1;
  canonicalization: string;
  sender: string;
  to: string[];
  cc: string[];
  subject: string;
  authored_text_hash: string;
  attachment_hashes: AttachmentDigest[];
  timestamp: string;
  nonce: string;
  signing_key_id: string;
  algorithm: string;
}

export type HtmlCorrespondence = "match" | "differs" | "unknown";

export interface SemanticVerificationResult {
  state: "not-present" | "verified" | "invalid" | "manifest-mismatch";
  authoredText: "verified" | "modified" | "unknown";
  attachments: "verified" | "modified" | "missing" | "unexpected";
  htmlCorrespondence: HtmlCorrespondence;
  unsignedContentAdded: boolean;
  manifest?: SemanticManifestV1;
  reason?: string;
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function digestAttachment(att: LogicalAttachment): Promise<AttachmentDigest> {
  const hash = await sha256Hex(att.data);
  return {
    filename: att.filename,
    media_type: att.mediaType,
    size: att.size,
    sha256: hash,
  };
}

export async function hashAuthoredText(text: string): Promise<string> {
  return sha256Hex(canonicalizeAuthoredText(text));
}

export interface BuildManifestInput {
  message: LogicalMessage;
  senderEmail: string;
  signingKeyId: string;
  nonce: string;
  timestamp?: string;
  algorithm?: string;
}

/** Build manifest excluding Bcc from recipient-visible fields. */
export async function buildSemanticManifest(input: BuildManifestInput): Promise<SemanticManifestV1> {
  const { message, senderEmail, signingKeyId, nonce } = input;
  const attachment_hashes = await Promise.all(
    (message.attachments ?? []).map((a) => digestAttachment(a)),
  );
  attachment_hashes.sort((a, b) => a.sha256.localeCompare(b.sha256));

  return {
    version: 1,
    canonicalization: canonicalizationProfile(),
    sender: senderEmail.toLowerCase(),
    to: recipientEmails(message.to),
    cc: recipientEmails(message.cc),
    subject: message.subject ?? "",
    authored_text_hash: await hashAuthoredText(message.authoredText),
    attachment_hashes,
    timestamp: input.timestamp ?? new Date().toISOString(),
    nonce,
    signing_key_id: signingKeyId,
    algorithm: input.algorithm ?? "ed25519",
  };
}

export function canonicalManifestBytes(manifest: SemanticManifestV1): string {
  return canonicalizeJson(manifest);
}

export async function signManifest(
  manifest: SemanticManifestV1,
  signFn: (payload: Uint8Array) => Promise<Uint8Array>,
): Promise<{ manifest: SemanticManifestV1; signature: Uint8Array; manifestJson: string }> {
  const manifestJson = canonicalManifestBytes(manifest);
  const signature = await signFn(new TextEncoder().encode(manifestJson));
  return { manifest, signature, manifestJson };
}

export function compareHtmlToSignedText(
  signedPlainText: string,
  html: string | undefined,
  htmlToText: (html: string) => string,
): HtmlCorrespondence {
  if (!html?.trim()) return "unknown";
  const fromHtml = canonicalizeAuthoredText(htmlToText(html));
  const signed = canonicalizeAuthoredText(signedPlainText);
  return fromHtml === signed ? "match" : "differs";
}

export interface VerifyManifestInput {
  manifest: SemanticManifestV1;
  message: LogicalMessage;
  signatureValid: boolean;
  html?: string;
  htmlToText?: (html: string) => string;
}

export async function verifySemanticManifest(
  input: VerifyManifestInput,
): Promise<SemanticVerificationResult> {
  const { manifest, message, signatureValid } = input;
  if (!signatureValid) {
    return {
      state: "invalid",
      authoredText: "unknown",
      attachments: "missing",
      htmlCorrespondence: "unknown",
      unsignedContentAdded: false,
      reason: "Signature cryptographically invalid",
    };
  }

  const expected = await buildSemanticManifest({
    message,
    senderEmail: manifest.sender,
    signingKeyId: manifest.signing_key_id,
    nonce: manifest.nonce,
    timestamp: manifest.timestamp,
    algorithm: manifest.algorithm,
  });

  const subjectMatch = (message.subject ?? "") === manifest.subject;
  const senderMatch = normalizeRecipients(message.from ? [message.from] : [])[0]?.emailAddress === manifest.sender;
  const toMatch =
    JSON.stringify(recipientEmails(message.to)) === JSON.stringify(manifest.to);
  const ccMatch =
    JSON.stringify(recipientEmails(message.cc)) === JSON.stringify(manifest.cc);
  const textHash = await hashAuthoredText(message.authoredText);
  const textMatch = textHash === manifest.authored_text_hash;

  const attachmentDigests = await Promise.all(
    (message.attachments ?? []).map((a) => digestAttachment(a)),
  );
  attachmentDigests.sort((a, b) => a.sha256.localeCompare(b.sha256));
  const attachmentsMatch =
    JSON.stringify(attachmentDigests) === JSON.stringify(manifest.attachment_hashes);

  let attachments: SemanticVerificationResult["attachments"] = "verified";
  if (!attachmentsMatch) {
    if (attachmentDigests.length > manifest.attachment_hashes.length) {
      attachments = "unexpected";
    } else if (attachmentDigests.length < manifest.attachment_hashes.length) {
      attachments = "missing";
    } else {
      attachments = "modified";
    }
  }

  const htmlCorrespondence = compareHtmlToSignedText(
    message.authoredText,
    input.html ?? message.html,
    input.htmlToText ?? defaultHtmlToText,
  );

  const fieldMismatch = !subjectMatch || !senderMatch || !toMatch || !ccMatch || !textMatch;
  if (fieldMismatch) {
    return {
      state: "manifest-mismatch",
      authoredText: textMatch ? "verified" : "modified",
      attachments,
      htmlCorrespondence,
      unsignedContentAdded: false,
      manifest,
      reason: "Manifest fields do not match message content",
    };
  }

  return {
    state: "verified",
    authoredText: "verified",
    attachments,
    htmlCorrespondence,
    unsignedContentAdded: false,
    manifest,
  };
}

function defaultHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function wrapSemanticSignatureParts(
  manifestJson: string,
  signatureBase64: string,
  boundary: string,
): string {
  return [
    `--${boundary}`,
    `Content-Type: ${MANIFEST_MIME}; charset="utf-8"`,
    "",
    manifestJson,
    `--${boundary}`,
    `Content-Type: ${SIGNATURE_MIME}`,
    "Content-Transfer-Encoding: base64",
    "",
    signatureBase64,
    `--${boundary}--`,
  ].join("\r\n");
}
