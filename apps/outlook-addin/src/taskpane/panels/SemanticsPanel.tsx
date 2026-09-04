import { useState } from "react";
import { LocalUidProvider } from "@scomm-office/core";
import { ScommMessageMetadataAdapter } from "@scomm-office/office";
import { HeuristicSemanticExtractor, sha256SemanticDocument } from "@scomm-office/semantics";
import type { SemanticBodySegment } from "@scomm-office/semantics";
import { Checkbox } from "@fluentui/react-components";
import { Button, MessageBar, MessageBarBody, Note, PageTitle, Textarea, usePaneStyles } from "../ui/layout";
import { useHostContext } from "../../lib/host-context";

const SEGMENT_TYPES: SemanticBodySegment["type"][] = [
  "authored",
  "signature",
  "legalese",
  "quoted",
  "forwarded",
  "attachment_reference",
  "greeting",
  "closing",
  "action_request",
  "structured_data",
  "unknown",
];

export function SemanticsPanel() {
  const styles = usePaneStyles();
  const { message, mailHost, capabilities, semanticDoc, setSemanticDoc } = useHostContext();
  const [busy, setBusy] = useState(false);
  const [stampMessage, setStampMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    if (!message) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const extractor = new HeuristicSemanticExtractor();
      const result = await extractor.extract({
        document: {
          subject: message.subject,
          html: message.bodyHtml,
          plainText: message.bodyText,
          from: message.from,
          to: message.to,
          cc: message.cc,
          bcc: message.bcc,
          attachments: message.attachments,
          headers: message.headers,
        },
      });
      setSemanticDoc(result.document);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const stampHeaders = async () => {
    if (!semanticDoc) {
      setStampMessage("Run Analyze first.");
      return;
    }
    if (mailHost.getMode() !== "compose") {
      setStampMessage("Header stamping requires compose mode.");
      return;
    }
    if (!capabilities.internetHeaders) {
      setStampMessage("Internet headers require Mailbox 1.8+.");
      return;
    }

    setBusy(true);
    setStampMessage(null);
    try {
      const digest = await sha256SemanticDocument(semanticDoc);
      const uidProvider = new LocalUidProvider();
      const messageUid = await uidProvider.create("msg");
      const adapter = new ScommMessageMetadataAdapter(mailHost);
      await adapter.write({
        version: "1",
        messageUid,
        schema: "semantics/1.0",
        semantics: "heuristic",
        semanticDigest: digest,
      });
      setStampMessage(`Stamped X-SComm headers (digest ${digest.slice(0, 12)}…).`);
    } catch (err) {
      setStampMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const presentTypes = new Set(semanticDoc?.segments.map((segment) => segment.type) ?? []);

  return (
    <>
      <PageTitle title="Semantics" />
      <div className={styles.actions}>
        <Button appearance="primary" size="small" disabled={busy || !message} onClick={() => void analyze()}>
          Analyze
        </Button>
        <Button appearance="secondary" size="small" disabled={busy || !semanticDoc} onClick={() => void stampHeaders()}>
          Stamp headers
        </Button>
      </div>
      {error ? (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      ) : null}
      {stampMessage ? <Note>{stampMessage}</Note> : null}

      {semanticDoc ? (
        <>
          <PageTitle title="Segment types" />
          <ul className="checklist">
            {SEGMENT_TYPES.map((type) => (
              <li key={type}>
                <Checkbox checked={presentTypes.has(type)} disabled label={type} />
              </li>
            ))}
          </ul>
          <PageTitle title="Semantic JSON" />
          <Textarea
            className={styles.code}
            readOnly
            value={JSON.stringify(semanticDoc, null, 2)}
            rows={16}
            resize="vertical"
          />
        </>
      ) : (
        <Note>No semantic document yet. Click Analyze to run HeuristicSemanticExtractor.</Note>
      )}
    </>
  );
}
