import type { SemanticMailDocument } from "./semantic-document.js";

export type PolicyAction = "allow" | "warn" | "block";

export interface PolicyFinding {
  ruleId: string;
  severity: "info" | "warning" | "error";
  message: string;
  action: PolicyAction;
}

export interface PolicyEvaluation {
  findings: PolicyFinding[];
  allowed: boolean;
}

export interface KeywordPolicyRule {
  keywords: string[];
  action: "warn" | "block";
  caseSensitive?: boolean;
}

export interface PolicyContext {
  document: SemanticMailDocument;
  recipients: string[];
  internalDomains: string[];
  attachmentCount?: number;
  classificationRequired?: boolean;
  keywordPolicy?: KeywordPolicyRule;
}

export interface PolicyRule {
  id: string;
  evaluate(context: PolicyContext): PolicyFinding | null;
}

export interface PolicyEngine {
  evaluate(context: PolicyContext): PolicyEvaluation;
}

export interface SendDecision {
  mode: PolicyAction;
  message?: string;
  findings?: PolicyFinding[];
}

export function mapPolicyToSendDecision(evaluation: PolicyEvaluation): SendDecision {
  const findings = evaluation.findings;
  const blockFinding = findings.find((finding) => finding.action === "block");
  if (blockFinding) {
    return { mode: "block", message: blockFinding.message, findings };
  }

  const warnFinding = findings.find((finding) => finding.action === "warn");
  if (warnFinding) {
    return { mode: "warn", message: warnFinding.message, findings };
  }

  return { mode: "allow", findings };
}

function recipientDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) {
    return null;
  }
  return email.slice(at + 1).toLowerCase();
}

function isExternalRecipient(email: string, internalDomains: string[]): boolean {
  const domain = recipientDomain(email);
  if (!domain) {
    return true;
  }
  return !internalDomains.some(
    (internal) => domain === internal.toLowerCase() || domain.endsWith(`.${internal.toLowerCase()}`),
  );
}

function documentText(document: SemanticMailDocument): string {
  return document.segments.map((segment) => segment.content).join("\n");
}

export const externalRecipientWarningRule: PolicyRule = {
  id: "externalRecipientWarning",
  evaluate(context) {
    const external = context.recipients.filter((recipient) =>
      isExternalRecipient(recipient, context.internalDomains),
    );
    if (external.length === 0) {
      return null;
    }
    return {
      ruleId: "externalRecipientWarning",
      severity: "warning",
      message: `Message includes external recipient(s): ${external.join(", ")}`,
      action: "warn",
    };
  },
};

export const attachmentPresentRule: PolicyRule = {
  id: "attachmentPresent",
  evaluate(context) {
    const count = context.attachmentCount ?? 0;
    if (count <= 0) {
      return null;
    }
    return {
      ruleId: "attachmentPresent",
      severity: "info",
      message: `Message includes ${count} attachment(s)`,
      action: "warn",
    };
  },
};

export const keywordPolicyRule: PolicyRule = {
  id: "keywordPolicy",
  evaluate(context) {
    const policy = context.keywordPolicy;
    if (!policy || policy.keywords.length === 0) {
      return null;
    }

    const haystack = policy.caseSensitive
      ? documentText(context.document)
      : documentText(context.document).toLowerCase();

    for (const keyword of policy.keywords) {
      const needle = policy.caseSensitive ? keyword : keyword.toLowerCase();
      if (haystack.includes(needle)) {
        return {
          ruleId: "keywordPolicy",
          severity: policy.action === "block" ? "error" : "warning",
          message: `Message contains restricted keyword: ${keyword}`,
          action: policy.action,
        };
      }
    }

    return null;
  },
};

export const missingClassificationRule: PolicyRule = {
  id: "missingClassification",
  evaluate(context) {
    if (!context.classificationRequired) {
      return null;
    }
    if (context.document.classification?.label) {
      return null;
    }
    return {
      ruleId: "missingClassification",
      severity: "error",
      message: "Classification is required before sending",
      action: "block",
    };
  },
};

export class DeterministicPolicyEngine implements PolicyEngine {
  constructor(private readonly rules: PolicyRule[] = DEFAULT_POLICY_RULES) {}

  evaluate(context: PolicyContext): PolicyEvaluation {
    const findings: PolicyFinding[] = [];
    for (const rule of this.rules) {
      const finding = rule.evaluate(context);
      if (finding) {
        findings.push(finding);
      }
    }

    const allowed = !findings.some((finding) => finding.action === "block");
    return { findings, allowed };
  }
}

export const DEFAULT_POLICY_RULES: PolicyRule[] = [
  externalRecipientWarningRule,
  attachmentPresentRule,
  keywordPolicyRule,
  missingClassificationRule,
];
