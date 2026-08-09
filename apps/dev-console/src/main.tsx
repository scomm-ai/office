import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { LocalUidProvider } from "@scomm-office/core";
import { MockMailHost } from "@scomm-office/office";
import {
  DeterministicPolicyEngine,
  mapPolicyToSendDecision,
} from "@scomm-office/policy";
import { HeuristicSemanticExtractor, sha256SemanticDocument } from "@scomm-office/semantics";
import type { FixtureName } from "@scomm-office/testkit";
import { FIXTURE_OPTIONS, fixtureHtml } from "./fixtures";
import { buildHeadersPreview, toPolicyDocument } from "./lib/analysis";
import "./styles.css";

async function runAnalysis(html: string) {
  const host = new MockMailHost({
    mode: "read",
    subject: "Dev console sample",
    bodyHtml: html,
    from: { emailAddress: "sender@example.com" },
    to: [{ emailAddress: "recipient@example.com" }],
  });
  const message = await host.getCurrentMessage();
  const extractor = new HeuristicSemanticExtractor();
  const { document } = await extractor.extract({
    document: {
      subject: message.subject,
      html: message.bodyHtml,
      plainText: message.bodyText,
      from: message.from,
      to: message.to,
    },
  });

  const digest = await sha256SemanticDocument(document);
  const uidProvider = new LocalUidProvider();
  const messageUid = await uidProvider.create("msg");
  const headers = buildHeadersPreview(digest, messageUid);

  const engine = new DeterministicPolicyEngine();
  const evaluation = engine.evaluate({
    document: toPolicyDocument(document),
    recipients: ["recipient@example.com"],
    internalDomains: ["example.com"],
    attachmentCount: 0,
    keywordPolicy: { keywords: ["confidential"], action: "warn" },
  });
  const sendDecision = mapPolicyToSendDecision(evaluation);

  return {
    rawHtml: html,
    segments: document.segments,
    semanticJson: document,
    policy: { evaluation, sendDecision },
    headers,
    digest,
  };
}

function App() {
  const [fixture, setFixture] = useState<FixtureName>("simple");
  const [html, setHtml] = useState(() => fixtureHtml("simple"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof runAnalysis>> | null>(null);

  const fixtureSelect = useMemo(
    () =>
      FIXTURE_OPTIONS.map((option) => (
        <option key={option.name} value={option.name}>
          {option.label}
        </option>
      )),
    [],
  );

  const loadFixture = (name: FixtureName) => {
    setFixture(name);
    setHtml(fixtureHtml(name));
    setResult(null);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    const text = await file.text();
    setHtml(text);
    setResult(null);
    setFixture("simple");
  };

  const analyze = async () => {
    setBusy(true);
    setError(null);
    try {
      const output = await runAnalysis(html);
      setResult(output);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="layout">
      <header>
        <h1>SComm Dev Console</h1>
        <p>HeuristicSemanticExtractor + DeterministicPolicyEngine against testkit fixtures or pasted HTML.</p>
      </header>

      <div className="controls">
        <label>
          Fixture
          <select
            value={fixture}
            onChange={(event) => loadFixture(event.target.value as FixtureName)}
          >
            {fixtureSelect}
          </select>
        </label>
        <label>
          Load .html / .eml
          <input
            type="file"
            accept=".html,.htm,.eml,text/html,message/rfc822"
            onChange={(event) => void onFile(event.target.files?.[0])}
          />
        </label>
      </div>

      <label>
        HTML / body source
        <textarea value={html} onChange={(event) => setHtml(event.target.value)} rows={12} />
      </label>

      <div className="actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void analyze()}>
          Run analysis
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {result ? (
        <div className="grid">
          <section className="panel">
            <h2>Segments ({result.segments.length})</h2>
            <pre>{JSON.stringify(result.segments, null, 2)}</pre>
          </section>
          <section className="panel">
            <h2>Semantic JSON</h2>
            <pre>{JSON.stringify(result.semanticJson, null, 2)}</pre>
          </section>
          <section className="panel">
            <h2>Policy</h2>
            <pre>{JSON.stringify(result.policy, null, 2)}</pre>
          </section>
          <section className="panel">
            <h2>Headers preview (digest {result.digest.slice(0, 12)}…)</h2>
            <pre>{JSON.stringify(result.headers, null, 2)}</pre>
          </section>
          <section className="panel">
            <h2>Raw HTML</h2>
            <pre>{result.rawHtml.slice(0, 4000)}{result.rawHtml.length > 4000 ? "\n…" : ""}</pre>
          </section>
        </div>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
