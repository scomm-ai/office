import { useState } from "react";
import { LocalUidProvider } from "@scomm-office/core";
import { ScommMessageMetadataAdapter } from "@scomm-office/office";
import { HeuristicSemanticExtractor, sha256SemanticDocument } from "@scomm-office/semantics";
import type { SemanticBodySegment } from "@scomm-office/semantics";
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
    <section>
      <h2>Semantics</h2>
      <div className="actions">
        <button type="button" className="primary" disabled={busy || !message} onClick={() => void analyze()}>
          Analyze
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || !semanticDoc}
          onClick={() => void stampHeaders()}
        >
          Stamp headers
        </button>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {stampMessage ? <p className="note">{stampMessage}</p> : null}

      {semanticDoc ? (
        <>
          <section>
            <h2>Segment types</h2>
            <ul className="checklist">
              {SEGMENT_TYPES.map((type) => (
                <li key={type}>
                  <input type="checkbox" readOnly checked={presentTypes.has(type)} />
                  <span>{type}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2>Semantic JSON</h2>
            <textarea
              className="code-block"
              readOnly
              value={JSON.stringify(semanticDoc, null, 2)}
              rows={16}
            />
          </section>
        </>
      ) : (
        <p className="empty">No semantic document yet. Click Analyze to run HeuristicSemanticExtractor.</p>
      )}
    </section>
  );
}
