/** RFC 2045/2046 MIME construction and parsing — no Office.js dependencies. */

export const CRLF = "\r\n";

export interface MimePart {
  headers: Record<string, string>;
  body: Uint8Array | string;
  children?: MimePart[];
}

export interface MimeMessage {
  headers: Record<string, string>;
  body: Uint8Array | string;
  parts?: MimePart[];
}

export type MimeProtectionKind =
  | "unsigned"
  | "openpgp-signed"
  | "openpgp-encrypted"
  | "openpgp-sign-encrypt"
  | "smime-signed"
  | "smime-encrypted"
  | "smime-sign-encrypt"
  | "semantic-signed";

export interface MimeStructureInfo {
  kind: MimeProtectionKind;
  contentType: string;
  protocol?: string;
}

export function generateBoundary(prefix = "scomm"): string {
  const rand = crypto.getRandomValues(new Uint8Array(12));
  const hex = Array.from(rand, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${Date.now().toString(36)}_${hex}`;
}

export function encodeBase64Lines(data: Uint8Array, lineLength = 76): string {
  const b64 = btoa(String.fromCharCode(...data));
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += lineLength) {
    lines.push(b64.slice(i, i + lineLength));
  }
  return lines.join(CRLF);
}

export function decodeBase64(data: string): Uint8Array {
  const cleaned = data.replace(/\s/g, "");
  const binary = atob(cleaned);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function headerBlock(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join(CRLF);
}

function partToBytes(part: MimePart, boundary?: string): Uint8Array {
  if (part.children?.length && boundary) {
    const chunks: string[] = [];
    for (const child of part.children) {
      chunks.push(`--${boundary}${CRLF}`);
      chunks.push(headerBlock(child.headers));
      chunks.push(CRLF + CRLF);
      const body =
        typeof child.body === "string" ? child.body : new TextDecoder("latin1").decode(child.body);
      chunks.push(body);
      if (!body.endsWith(CRLF)) chunks.push(CRLF);
    }
    chunks.push(`--${boundary}--${CRLF}`);
    return new TextEncoder().encode(chunks.join(""));
  }

  const body =
    typeof part.body === "string" ? part.body : new TextDecoder("latin1").decode(part.body);
  const text = `${headerBlock(part.headers)}${CRLF}${CRLF}${body}`;
  return new TextEncoder().encode(text);
}

export function buildMultipartMixed(parts: MimePart[], boundary = generateBoundary("mixed")): MimeMessage {
  const mixed: MimePart = {
    headers: {
      "Content-Type": `multipart/mixed; boundary="${boundary}"`,
      "MIME-Version": "1.0",
    },
    body: "",
    children: parts,
  };
  const body = partToBytes(mixed, boundary);
  return {
    headers: mixed.headers,
    body,
  };
}

export function buildMultipartAlternative(
  plainText: string,
  html: string | undefined,
  boundary = generateBoundary("alt"),
): MimePart {
  const children: MimePart[] = [
    {
      headers: {
        "Content-Type": 'text/plain; charset="utf-8"',
        "Content-Transfer-Encoding": "quoted-printable",
      },
      body: encodeQuotedPrintable(plainText),
    },
  ];
  if (html) {
    children.push({
      headers: {
        "Content-Type": 'text/html; charset="utf-8"',
        "Content-Transfer-Encoding": "quoted-printable",
      },
      body: encodeQuotedPrintable(html),
    });
  }
  return {
    headers: {
      "Content-Type": `multipart/alternative; boundary="${boundary}"`,
    },
    body: "",
    children,
  };
}

export function buildAttachmentPart(
  filename: string,
  mediaType: string,
  data: Uint8Array,
): MimePart {
  return {
    headers: {
      "Content-Type": mediaType,
      "Content-Transfer-Encoding": "base64",
      "Content-Disposition": `attachment; filename="${escapeFilename(filename)}"`,
    },
    body: encodeBase64Lines(data),
  };
}

export function buildMessageFromParts(alternative: MimePart, attachments: MimePart[]): MimeMessage {
  if (attachments.length === 0) {
    const boundary = extractBoundary(alternative.headers["Content-Type"] ?? "");
    const body = partToBytes(alternative, boundary);
    return { headers: alternative.headers, body };
  }
  return buildMultipartMixed([alternative, ...attachments]);
}

/** RFC 3156 multipart/signed — signedEntity includes inner part headers+body. */
export function buildMultipartSigned(
  signedEntityBytes: Uint8Array,
  signatureArmored: string,
  boundary = generateBoundary("signed"),
): MimeMessage {
  const entityText = new TextDecoder("latin1").decode(signedEntityBytes);
  const chunks: string[] = [];

  chunks.push(`--${boundary}${CRLF}`);
  chunks.push(entityText.endsWith(CRLF) ? entityText : `${entityText}${CRLF}`);

  chunks.push(`--${boundary}${CRLF}`);
  chunks.push(`Content-Type: application/pgp-signature${CRLF}${CRLF}`);
  chunks.push(signatureArmored.trim());
  chunks.push(CRLF);

  chunks.push(`--${boundary}--${CRLF}`);

  return {
    headers: {
      "Content-Type": `multipart/signed; protocol="application/pgp-signature"; micalg="pgp-sha256"; boundary="${boundary}"`,
      "MIME-Version": "1.0",
    },
    body: new TextEncoder().encode(chunks.join("")),
  };
}

/** RFC 3156 multipart/encrypted — payload is base64-encoded binary. */
export function buildMultipartEncrypted(
  encryptedPayload: Uint8Array,
  boundary = generateBoundary("enc"),
): MimeMessage {
  const encoded = encodeBase64Lines(encryptedPayload);
  const chunks: string[] = [];

  chunks.push(`--${boundary}${CRLF}`);
  chunks.push(`Content-Type: application/pgp-encrypted${CRLF}${CRLF}`);
  chunks.push(`Version: 1${CRLF}${CRLF}`);

  chunks.push(`--${boundary}${CRLF}`);
  chunks.push(`Content-Type: application/octet-stream${CRLF}`);
  chunks.push(`Content-Transfer-Encoding: base64${CRLF}${CRLF}`);
  chunks.push(encoded);
  chunks.push(CRLF);

  chunks.push(`--${boundary}--${CRLF}`);

  return {
    headers: {
      "Content-Type": `multipart/encrypted; protocol="application/pgp-encrypted"; boundary="${boundary}"`,
      "MIME-Version": "1.0",
    },
    body: new TextEncoder().encode(chunks.join("")),
  };
}

export function mimeToEml(message: MimeMessage, extraHeaders?: Record<string, string>): Uint8Array {
  const headers = { ...extraHeaders, ...message.headers };
  const headerText = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join(CRLF);
  const bodyText =
    typeof message.body === "string" ? message.body : new TextDecoder("latin1").decode(message.body);
  return new TextEncoder().encode(`${headerText}${CRLF}${CRLF}${bodyText}`);
}

function extractBoundary(contentType: string): string {
  const match = /boundary="([^"]+)"/i.exec(contentType);
  return match?.[1] ?? generateBoundary();
}

function escapeFilename(name: string): string {
  return name.replace(/"/g, '\\"');
}

/** Minimal quoted-printable encoder for UTF-8 text. */
export function encodeQuotedPrintable(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const lines: string[] = [];
  let line = "";
  for (const byte of bytes) {
    const ch = String.fromCharCode(byte);
    if (byte === 10) {
      lines.push(line);
      line = "";
      continue;
    }
    if (
      (byte >= 33 && byte <= 60) ||
      (byte >= 62 && byte <= 126) ||
      ch === " " ||
      ch === "\t"
    ) {
      line += ch;
    } else {
      line += `=${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
    if (line.length >= 73) {
      lines.push(`${line}=`);
      line = "";
    }
  }
  if (line) lines.push(line);
  return lines.join(CRLF);
}

export function detectMimeStructure(raw: string | Uint8Array): MimeStructureInfo {
  const text =
    typeof raw === "string" ? raw : new TextDecoder("latin1").decode(raw);
  const ctMatch = /^Content-Type:\s*([^\r\n;]+)/im.exec(text);
  const contentType = ctMatch?.[1]?.trim().toLowerCase() ?? "text/plain";
  const protocolMatch = /protocol="([^"]+)"/i.exec(text);
  const protocol = protocolMatch?.[1]?.toLowerCase();

  if (contentType === "multipart/signed" && protocol === "application/pgp-signature") {
    return { kind: "openpgp-signed", contentType, protocol };
  }
  if (contentType === "multipart/encrypted" && protocol === "application/pgp-encrypted") {
    return { kind: "openpgp-encrypted", contentType, protocol };
  }
  if (contentType === "multipart/signed" && protocol?.includes("pkcs7")) {
    return { kind: "smime-signed", contentType, protocol };
  }
  if (contentType === "application/pkcs7-mime") {
    return { kind: "smime-encrypted", contentType };
  }
  if (text.includes("application/vnd.scomm.manifest+json")) {
    return { kind: "semantic-signed", contentType: "application/vnd.scomm.manifest+json" };
  }
  if (text.includes("-----BEGIN PGP MESSAGE-----")) {
    return { kind: "openpgp-encrypted", contentType: "text/plain" };
  }
  if (text.includes("-----BEGIN PGP SIGNED MESSAGE-----")) {
    return { kind: "openpgp-signed", contentType: "text/plain" };
  }
  return { kind: "unsigned", contentType };
}

export function extractSignedEntityFromMultipartSigned(raw: string | Uint8Array): {
  signedEntity: Uint8Array;
  signature: string;
} | null {
  const text =
    typeof raw === "string" ? raw : new TextDecoder("latin1").decode(raw);
  const ctMatch = /Content-Type:\s*multipart\/signed[^;\r\n]*(?:;[^\r\n]*)?/i.exec(text);
  if (!ctMatch) return null;
  const boundaryMatch = /boundary="([^"]+)"/i.exec(ctMatch[0]);
  if (!boundaryMatch?.[1]) return null;
  const boundary = boundaryMatch[1];

  const bodyStart = text.indexOf(CRLF + CRLF);
  const body = bodyStart >= 0 ? text.slice(bodyStart + 4) : text;

  const delimiter = `--${boundary}`;
  const endDelimiter = `--${boundary}--`;
  const firstIdx = body.indexOf(delimiter);
  if (firstIdx < 0) return null;
  const afterFirst = firstIdx + delimiter.length;
  const secondIdx = body.indexOf(CRLF + delimiter, afterFirst);
  if (secondIdx < 0) return null;

  let signedPart = body.slice(afterFirst, secondIdx);
  if (signedPart.startsWith(CRLF)) signedPart = signedPart.slice(2);

  const sigSection = body.slice(secondIdx + delimiter.length + 2);
  const sigStart = sigSection.indexOf("-----BEGIN PGP SIGNATURE-----");
  const sigEnd = sigSection.indexOf("-----END PGP SIGNATURE-----");
  if (sigStart < 0 || sigEnd < 0) return null;
  const signature = sigSection.slice(sigStart, sigEnd + "-----END PGP SIGNATURE-----".length).trim();
  if (!signature) return null;

  const signedEntity = signedPart.endsWith(CRLF) ? signedPart : `${signedPart}${CRLF}`;
  return {
    signedEntity: new TextEncoder().encode(signedEntity),
    signature,
  };
}

export function extractEncryptedPayloadFromMime(raw: string | Uint8Array): Uint8Array {
  const text =
    typeof raw === "string" ? raw : new TextDecoder("latin1").decode(raw);
  if (text.includes("BEGIN PGP MESSAGE")) {
    return new TextEncoder().encode(text.slice(text.indexOf("BEGIN PGP MESSAGE")));
  }
  const boundaryMatch = /boundary="([^"]+)"/i.exec(text);
  if (!boundaryMatch?.[1]) {
    throw new Error("No MIME boundary found");
  }
  const boundary = boundaryMatch[1];
  const parts = text.split(new RegExp(`--${escapeRegex(boundary)}(?!-)`));
  for (const part of parts) {
    if (/Content-Type:\s*application\/octet-stream/i.test(part)) {
      const bodyMatch = /\r?\n\r?\n([\s\S]*?)(?:\r?\n--|$)/.exec(part);
      if (bodyMatch?.[1]) {
        return decodeBase64(bodyMatch[1]);
      }
    }
  }
  throw new Error("Encrypted payload not found");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
