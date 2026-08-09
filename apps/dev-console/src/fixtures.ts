import type { FixtureName } from "@scomm-office/testkit";

import complexThreadHtml from "../../../packages/testkit/fixtures/complex-thread.html?raw";
import forwardHtml from "../../../packages/testkit/fixtures/forward.html?raw";
import legalDisclaimerHtml from "../../../packages/testkit/fixtures/legal-disclaimer.html?raw";
import replyWithQuoteHtml from "../../../packages/testkit/fixtures/reply-with-quote.html?raw";
import signatureHtml from "../../../packages/testkit/fixtures/signature.html?raw";
import simpleHtml from "../../../packages/testkit/fixtures/simple.html?raw";

export const FIXTURE_OPTIONS: Array<{ name: FixtureName; label: string; html: string }> = [
  { name: "simple", label: "simple", html: simpleHtml },
  { name: "reply-with-quote", label: "reply-with-quote", html: replyWithQuoteHtml },
  { name: "forward", label: "forward", html: forwardHtml },
  { name: "signature", label: "signature", html: signatureHtml },
  { name: "legal-disclaimer", label: "legal-disclaimer", html: legalDisclaimerHtml },
  { name: "complex-thread", label: "complex-thread", html: complexThreadHtml },
];

export function fixtureHtml(name: FixtureName): string {
  const match = FIXTURE_OPTIONS.find((option) => option.name === name);
  if (!match) {
    throw new Error(`Unknown fixture: ${name}`);
  }
  return match.html;
}
