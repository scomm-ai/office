import { useEffect, useState } from "react";
import {
  DeterministicPolicyEngine,
  mapPolicyToSendDecision,
  type PolicyEvaluation,
  type SendDecision,
} from "@scomm-office/policy";
import { MessageBar, MessageBarBody } from "@fluentui/react-components";
import { Note, PageTitle, StatusBadge, usePaneStyles } from "../ui/layout";
import { useHostContext } from "../../lib/host-context";
import {
  collectRecipientEmails,
  internalDomainsFromEmail,
  toPolicyDocument,
} from "../../lib/semantic-policy";

export function CompliancePanel() {
  const styles = usePaneStyles();
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
      <>
        <PageTitle title="Compliance" />
        <Note>Compliance checks disabled in Settings.</Note>
      </>
    );
  }

  if (!semanticDoc) {
    return (
      <>
        <PageTitle title="Compliance" />
        <Note>Run semantic analysis first (Semantics → Analyze).</Note>
      </>
    );
  }

  return (
    <>
      <PageTitle title="Compliance" description="DeterministicPolicyEngine on last semantic document." />
      {error ? (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      ) : null}
      {sendDecision ? (
        <dl className={styles.metaGrid}>
          <dt className={styles.metaLabel}>Send decision</dt>
          <dd>
            <StatusBadge
              tone={
                sendDecision.mode === "allow" ? "ok" : sendDecision.mode === "warn" ? "warn" : "error"
              }
            >
              {sendDecision.mode}
            </StatusBadge>
          </dd>
          {sendDecision.message ? (
            <>
              <dt className={styles.metaLabel}>Message</dt>
              <dd>{sendDecision.message}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      <FindingsList evaluation={policyEvaluation} />
    </>
  );
}

function FindingsList({ evaluation }: { evaluation: PolicyEvaluation | null }) {
  const styles = usePaneStyles();
  if (!evaluation?.findings.length) {
    return <Note>No policy findings.</Note>;
  }

  return (
    <ul className={styles.list}>
      {evaluation.findings.map((finding) => (
        <li key={finding.ruleId}>
          <strong>{finding.ruleId}</strong>{" "}
          <StatusBadge
            tone={finding.action === "block" ? "error" : finding.action === "warn" ? "warn" : "muted"}
          >
            {finding.action}
          </StatusBadge>
          <div>{finding.message}</div>
        </li>
      ))}
    </ul>
  );
}

export type { SendDecision };
