import type { CloudChatMessage } from "./cloud-client.js";

export interface EmailContextInput {
  mode: "read" | "compose";
  subject?: string;
  bodyText?: string;
  from?: { emailAddress: string; displayName?: string };
  to?: Array<{ emailAddress: string; displayName?: string }>;
}

const MAX_BODY_CHARS = 8_000;

function formatAddress(address: { emailAddress: string; displayName?: string }): string {
  return address.displayName ? `${address.displayName} <${address.emailAddress}>` : address.emailAddress;
}

/**
 * Builds the system message that grounds the assistant in the current email.
 * Pure and Office.js-free so it can be unit tested and reused by both the
 * read-mode Q&A flow and the compose-mode drafting flow.
 */
export function buildEmailContextMessage(input: EmailContextInput): CloudChatMessage {
  const lines: string[] = [];
  lines.push(
    input.mode === "compose"
      ? "You are assisting the user while they compose an email in Outlook."
      : "You are assisting the user while they read an email in Outlook.",
  );
  lines.push(`Subject: ${input.subject ?? "(no subject)"}`);
  if (input.from) {
    lines.push(`From: ${formatAddress(input.from)}`);
  }
  if (input.to?.length) {
    lines.push(`To: ${input.to.map(formatAddress).join(", ")}`);
  }
  lines.push("");
  lines.push(
    input.mode === "compose"
      ? "Current draft body:"
      : "Email body:",
  );
  lines.push((input.bodyText ?? "").slice(0, MAX_BODY_CHARS));
  if (input.mode === "compose") {
    lines.push("");
    lines.push(
      "When the user asks you to write or rewrite the draft, respond with the full replacement " +
        "body wrapped exactly as: <<<DRAFT>>>\n...body...\n<<<END>>>. " +
        "Put any commentary outside that block. Do not use the block unless the user asked for a draft change.",
    );
  }
  return { role: "system", content: lines.join("\n") };
}

const DRAFT_START_RE = /<<<DRAFT>>>[ \t]*\r?\n?/;
const DRAFT_END_MARKER = "<<<END>>>";

/**
 * Extracts a proposed draft body from an assistant reply, if present.
 *
 * Deliberately lenient about exact formatting: models — especially small
 * local ones — often don't follow the "marker on its own line, closing
 * marker present" instruction exactly (e.g. `<<<DRAFT>>> body text` with no
 * `<<<END>>>` at all). Requiring an exact match silently drops real drafts,
 * so this only requires the opening marker; it takes everything up to the
 * closing marker if present, otherwise the rest of the reply.
 */
export function extractProposedDraft(content: string): string | null {
  const start = DRAFT_START_RE.exec(content);
  if (!start) {
    return null;
  }
  const afterStart = content.slice(start.index + start[0].length);
  const endIndex = afterStart.indexOf(DRAFT_END_MARKER);
  const body = endIndex >= 0 ? afterStart.slice(0, endIndex) : afterStart;
  const trimmed = body.trim();
  return trimmed.length > 0 ? trimmed : null;
}
