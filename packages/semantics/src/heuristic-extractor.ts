import type {
  RawMailDocument,
  SemanticAction,
  SemanticBodySegment,
  SemanticEntity,
  SemanticMailDocument,
} from "./models.js";
import type { SemanticExtractor, SemanticExtractionInput, SemanticExtractionResult } from "./extractor.js";

const SCHEMA_VERSION = "1.0";

let segmentCounter = 0;

function nextSegmentId(prefix: string): string {
  segmentCounter += 1;
  return `${prefix}_${segmentCounter}`;
}

function resetSegmentCounter(): void {
  segmentCounter = 0;
}

function stripScripts(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

function htmlToText(html: string): string {
  return stripScripts(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeInput(document: RawMailDocument): { html?: string; text: string } {
  const html = document.html ? stripScripts(document.html) : undefined;
  const text = document.plainText?.trim() || (html ? htmlToText(html) : "");
  return { html, text };
}

function makeSegment(
  type: SemanticBodySegment["type"],
  content: { text?: string; html?: string; confidence?: number },
  extra: Partial<SemanticBodySegment> = {},
): SemanticBodySegment {
  return {
    id: nextSegmentId(type),
    type,
    schemaVersion: SCHEMA_VERSION,
    confidence: content.confidence ?? 0.7,
    text: content.text,
    html: content.html,
    ...extra,
  } as SemanticBodySegment;
}

function findForwardedBlock(html: string, text: string): { html?: string; text: string } | null {
  const patterns = [/forwarded message/i, /begin forwarded message/i];
  const textMatch = patterns.some((pattern) => pattern.test(text));
  const htmlMatch =
    patterns.some((pattern) => pattern.test(html)) ||
    /<strong>\s*-+\s*Forwarded message\s*-+\s*<\/strong>/i.test(html);

  if (!textMatch && !htmlMatch) {
    return null;
  }

  const splitPattern =
    /(?:^|\n)(?:-{2,}\s*)?(?:Begin forwarded message|----- Forwarded message -----)/i;
  const textParts = text.split(splitPattern);
  const forwardedText = textParts.length > 1 ? textParts.slice(1).join("\n").trim() : text;

  const htmlParts = html.split(/(?:Begin forwarded message|Forwarded message)/i);
  const forwardedHtml = htmlParts.length > 1 ? htmlParts.slice(1).join("").trim() : html;

  return {
    text: forwardedText,
    html: forwardedHtml || undefined,
  };
}

function findQuotedBlocks(html: string, text: string): Array<{ html?: string; text: string }> {
  const blocks: Array<{ html?: string; text: string }> = [];

  const outlookMatch = html.match(/<div[^>]*id=["']divRplyFwdMsg["'][^>]*>[\s\S]*?<\/div>/i);
  if (outlookMatch) {
    blocks.push({ html: outlookMatch[0], text: htmlToText(outlookMatch[0]) });
  }

  const gmailMatches = html.match(/<div[^>]*class=["'][^"']*gmail_quote[^"']*["'][^>]*>[\s\S]*?<\/div>/gi);
  if (gmailMatches) {
    for (const match of gmailMatches) {
      blocks.push({ html: match, text: htmlToText(match) });
    }
  }

  const blockquoteMatches = html.match(/<blockquote[\s\S]*?<\/blockquote>/gi);
  if (blockquoteMatches) {
    for (const match of blockquoteMatches) {
      blocks.push({ html: match, text: htmlToText(match) });
    }
  }

  const wrotePattern = /(?:^|\n)(?:On .+ wrote:|From:.+\n(?:Sent:|Date:).+\n(?:To:|Subject:).+)/i;
  if (wrotePattern.test(text)) {
    const wroteSplit = text.split(/\n(?=On .+ wrote:)/i);
    if (wroteSplit.length > 1) {
      blocks.push({ text: wroteSplit.slice(1).join("\n").trim() });
    }

    const fromSplit = text.split(/\n(?=<strong>From:<\/strong>|From:)/i);
    if (fromSplit.length > 1 && /(?:Sent:|Date:|Subject:)/i.test(fromSplit[1] ?? "")) {
      blocks.push({ text: fromSplit.slice(1).join("\n").trim() });
    }
  }

  const quotedLines = text
    .split("\n")
    .filter((line) => line.trimStart().startsWith(">"))
    .join("\n")
    .trim();
  if (quotedLines) {
    blocks.push({ text: quotedLines });
  }

  return blocks;
}

function findLegaleseBlock(text: string): { text: string } | null {
  const pattern =
    /(confidentiality|privileged|legal disclaimer|intended solely for the use|strictly prohibited)/i;
  const match = text.match(
    new RegExp(`([\\s\\S]{0,200}${pattern.source}[\\s\\S]*)`, "i"),
  );
  if (!match) {
    return null;
  }
  return { text: match[1]?.trim() ?? text };
}

function findSignatureBlock(text: string, html?: string): { text: string; html?: string } | null {
  const delimiterMatch = text.match(/\n--\s*\n([\s\S]+)$/) ?? text.match(/\n--\s+([\s\S]+)$/);
  if (delimiterMatch) {
    return { text: delimiterMatch[0].trim() };
  }

  if (html && /(?:<p>\s*--|<br\s*\/?>\s*--|--\s*<br)/i.test(html)) {
    const htmlMatch = html.match(/(--[\s\S]+)$/i);
    if (htmlMatch) {
      return { text: htmlToText(htmlMatch[0]), html: htmlMatch[0] };
    }
  }

  const mobilePattern = /(sent from my (iphone|ipad|android|mobile))/i;
  const mobileMatch = text.match(new RegExp(`([\\s\\S]{0,120}${mobilePattern.source}[\\s\\S]*)`, "i"));
  if (mobileMatch) {
    return { text: mobileMatch[1]?.trim() ?? text };
  }

  const tail = text.slice(Math.max(0, text.length - 400));
  if (/\n--\s*\n/.test(tail) || /--\s*\n/.test(tail)) {
    const tailMatch = tail.match(/(--[\s\S]+)$/);
    if (tailMatch) {
      return { text: tailMatch[1]?.trim() ?? tail };
    }
  }

  return null;
}

function removeChunk(source: string, chunk: string): string {
  if (!chunk) {
    return source;
  }
  return source.replace(chunk, "").replace(/\n{3,}/g, "\n\n").trim();
}

function extractEntities(text: string): SemanticEntity[] {
  const entities: SemanticEntity[] = [];
  const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const urlPattern = /https?:\/\/[^\s<>"']+/gi;

  let entityCounter = 0;
  const seen = new Set<string>();

  for (const match of text.matchAll(emailPattern)) {
    const value = match[0];
    const key = `email:${value.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entityCounter += 1;
    entities.push({
      id: `entity_email_${entityCounter}`,
      type: "email",
      value,
      confidence: 0.8,
    });
  }

  for (const match of text.matchAll(urlPattern)) {
    const value = match[0];
    const key = `url:${value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entityCounter += 1;
    entities.push({
      id: `entity_url_${entityCounter}`,
      type: "url",
      value,
      confidence: 0.8,
    });
  }

  return entities;
}

function extractActions(text: string): { segments: ActionRequestSegmentLike[]; actions: SemanticAction[] } {
  const segments: ActionRequestSegmentLike[] = [];
  const actions: SemanticAction[] = [];
  let actionCounter = 0;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!/^please\b/i.test(trimmed)) {
      continue;
    }

    actionCounter += 1;
    segments.push({
      text: trimmed,
      confidence: 0.65,
    });
    actions.push({
      id: `action_${actionCounter}`,
      type: "request",
      description: trimmed,
      confidence: 0.65,
    });
  }

  return { segments, actions };
}

type ActionRequestSegmentLike = { text: string; confidence: number };

function detectSegments(html: string | undefined, text: string): SemanticBodySegment[] {
  const segments: SemanticBodySegment[] = [];
  let remainingText = text;
  let remainingHtml = html ?? "";

  const forwarded = findForwardedBlock(remainingHtml, remainingText);
  if (forwarded) {
    segments.push(
      makeSegment("forwarded", forwarded, {
        confidence: 0.85,
      }),
    );
    remainingText = removeChunk(remainingText, forwarded.text);
    if (forwarded.html) {
      remainingHtml = remainingHtml.replace(forwarded.html, "");
    }
  }

  const quotedBlocks = findQuotedBlocks(remainingHtml, remainingText);
  for (const quoted of quotedBlocks) {
    segments.push(
      makeSegment("quoted", quoted, {
        confidence: 0.8,
      }),
    );
    remainingText = removeChunk(remainingText, quoted.text);
    if (quoted.html) {
      remainingHtml = remainingHtml.replace(quoted.html, "");
    }
  }

  const legalese = findLegaleseBlock(remainingText);
  if (legalese) {
    segments.push(
      makeSegment("legalese", legalese, {
        confidentiality: /confidential|privileged/i.test(legalese.text),
        rawText: legalese.text,
        confidence: 0.9,
      }),
    );
    remainingText = removeChunk(remainingText, legalese.text);
  }

  const signature = findSignatureBlock(remainingText, remainingHtml);
  if (signature) {
    segments.push(
      makeSegment("signature", signature, {
        confidence: 0.75,
      }),
    );
    remainingText = removeChunk(remainingText, signature.text);
    if (signature.html) {
      remainingHtml = remainingHtml.replace(signature.html, "");
    }
  }

  const { segments: actionSegments } = extractActions(remainingText);
  for (const actionSegment of actionSegments) {
    segments.push(makeSegment("action_request", actionSegment));
  }

  if (remainingText.trim()) {
    segments.push(
      makeSegment("authored", {
        text: remainingText.trim(),
        html: remainingHtml.trim() || undefined,
        confidence: 0.7,
      }),
    );
  }

  if (segments.length === 0) {
    segments.push(
      makeSegment("unknown", { text: text || undefined, html: html || undefined }, {
        reason: "no structure detected",
        confidence: 0.3,
      }),
    );
  }

  return segments;
}

function detectDocument(input: RawMailDocument): SemanticMailDocument {
  resetSegmentCounter();

  const { html, text } = normalizeInput(input);
  const segments = detectSegments(html, text);
  const entities = extractEntities(text);
  const actions = extractActions(text).actions;

  return {
    version: "1.0",
    segments,
    entities,
    actions,
    metadata: {},
  };
}

export class HeuristicSemanticExtractor implements SemanticExtractor {
  async extract(input: SemanticExtractionInput): Promise<SemanticExtractionResult> {
    return { document: detectDocument(input.document) };
  }
}

function hasSegmentType(segments: SemanticBodySegment[], type: SemanticBodySegment["type"]): boolean {
  return segments.some((segment) => segment.type === type);
}

export { hasSegmentType };
