import { useEffect, useState } from "react";
import {
  DeterministicPolicyEngine,
  mapPolicyToSendDecision,
  type PolicyEvaluation,
  type SendDecision,
} from "@scomm-office/policy";
import { useHostContext } from "../../lib/host-context";
import {
  collectRecipientEmails,
  internalDomainsFromEmail,
  toPolicyDocument,
} from "../../lib/semantic-policy";

export function CompliancePanel() {
  const { message, semanticDoc, policyEvaluation, sendDecision, setPolicyResult, settings } =
    useHostContext();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings.complianceEnabled) {
      setPolicyResult(null, null);
      return;
    }
    if (!semanticDoc || !message) {
      setPolicyResult(null, null);
      return;
    }

    try {
      const engine = new DeterministicPolicyEngine();
      const evaluation = engine.evaluate({
        document: toPolicyDocument(semanticDoc),
        recipients: collectRecipientEmails(message),
        internalDomains: internalDomainsFromEmail(message.from?.emailAddress),
        attachmentCount: message.attachments?.length ?? 0,
        classificationRequired: false,
        keywordPolicy: {
          keywords: ["confidential", "privileged"],
          action: "warn",
        },
      });
      const decision = mapPolicyToSendDecision(evaluation);
      setPolicyResult(evaluation, decision);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [message, semanticDoc, settings.complianceEnabled, setPolicyResult]);

  if (!settings.complianceEnabled) {
    return (
      <section>
        <h2>Compliance</h2>
        <p className="empty">Compliance checks disabled in Settings.</p>
      </section>
    );
  }

  if (!semanticDoc) {
    return (
      <section>
        <h2>Compliance</h2>
        <p className="empty">Run semantic analysis first (Semantics → Analyze).</p>
      </section>
    );
  }

  return (
    <section>
      <h2>Compliance</h2>
      <p className="note">DeterministicPolicyEngine on last semantic document.</p>
      {error ? <p className="error-text">{error}</p> : null}
      {sendDecision ? (
        <dl className="meta-grid">
          <dt>Send decision</dt>
          <dd>
            <span
              className={`status ${
                sendDecision.mode === "allow"
                  ? "ok"
                  : sendDecision.mode === "warn"
                    ? "warn"
                    : "error"
              }`}
            >
              {sendDecision.mode}
            </span>
          </dd>
          {sendDecision.message ? (
            <>
              <dt>Message</dt>
              <dd>{sendDecision.message}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      <FindingsList evaluation={policyEvaluation} />
    </section>
  );
}

function FindingsList({ evaluation }: { evaluation: PolicyEvaluation | null }) {
  if (!evaluation?.findings.length) {
    return <p className="empty">No policy findings.</p>;
  }

  return (
    <ul className="list-plain">
      {evaluation.findings.map((finding) => (
        <li key={finding.ruleId}>
          <strong>{finding.ruleId}</strong>{" "}
          <span
            className={`status ${
              finding.action === "block" ? "error" : finding.action === "warn" ? "warn" : "muted"
            }`}
          >
            {finding.action}
          </span>
          <div>{finding.message}</div>
        </li>
      ))}
    </ul>
  );
}

export type { SendDecision };
