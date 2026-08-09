import { useRef, useState } from "react";
import { detectIdrRuntimeSupport, IdrBrowserTransport, OllamaViaIdrProvider } from "@scomm-office/idr";
import { useHostContext } from "../../lib/host-context";

export function IdrPanel() {
  const { settings, idrRuntime, idrConnected, setIdrRuntime, setIdrConnected, updateSettings } =
    useHostContext();
  const authMountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [transport] = useState(() => new IdrBrowserTransport(settings.idrDefaultService ?? "ollama"));

  const refreshRuntime = async () => {
    const runtime = await detectIdrRuntimeSupport();
    setIdrRuntime(runtime);
    setStatus(`Runtime: ${runtime.status} (WebRTC ${runtime.webRtc ? "yes" : "no"}, Ed25519 ${runtime.webCryptoEd25519 ? "yes" : "no"})`);
  };

  const authenticate = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await transport.ensureSession({
        interactive: true,
        mount: authMountRef.current ?? undefined,
      });
      setStatus("IDR session established.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setIdrConnected(false);
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    if (!settings.idrTargetHost) {
      setStatus("Set IDR host in Settings or below.");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await transport.connect({
        host: settings.idrTargetHost,
        service: settings.idrDefaultService ?? "ollama",
      });
      setIdrConnected(true);
      setStatus(`Connected to ${settings.idrTargetHost} (${transport.getState()}).`);
    } catch (error) {
      setIdrConnected(false);
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const listModels = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const provider = new OllamaViaIdrProvider(transport);
      const names = await provider.listModels();
      setModels(names);
      setIdrConnected(true);
      setStatus(`Listed ${names.length} model(s).`);
    } catch (error) {
      setModels([]);
      setIdrConnected(false);
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>AI / IDR</h2>
      <p className="note">
        IDR is a third-party subscription at idr.to. SComm Office embeds @idrto/idr_browser_sdk only —
        there is no Office IDR proxy. WebRTC may be unavailable on some Outlook hosts; use HTTPS relay
        when offered by the SDK.
      </p>

      <div className="field">
        <label htmlFor="idr-host">IDR host</label>
        <input
          id="idr-host"
          type="text"
          value={settings.idrTargetHost ?? ""}
          placeholder="your-machine.idr.to"
          onChange={(event) => updateSettings({ idrTargetHost: event.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="idr-service">Service</label>
        <input
          id="idr-service"
          type="text"
          value={settings.idrDefaultService ?? "ollama"}
          onChange={(event) => updateSettings({ idrDefaultService: event.target.value })}
        />
      </div>

      <div ref={authMountRef} className="note" aria-label="IDR auth mount">
        IDR auth widget mounts here during interactive authenticate.
      </div>

      <div className="actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void authenticate()}>
          Authenticate
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={() => void testConnection()}>
          Test connection
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={() => void listModels()}>
          List models
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={() => void refreshRuntime()}>
          Detect runtime
        </button>
      </div>

      {idrRuntime ? (
        <dl className="meta-grid">
          <dt>Runtime status</dt>
          <dd>
            <span
              className={`status ${
                idrRuntime.status === "supported"
                  ? "ok"
                  : idrRuntime.status === "unsupported"
                    ? "warn"
                    : "error"
              }`}
            >
              {idrRuntime.status}
            </span>
          </dd>
          <dt>WebRTC</dt>
          <dd>{idrRuntime.webRtc ? "available" : "unavailable"}</dd>
          <dt>Ed25519</dt>
          <dd>{idrRuntime.webCryptoEd25519 ? "available" : "unavailable"}</dd>
        </dl>
      ) : (
        <p className="empty">Runtime support not probed yet.</p>
      )}

      {!idrConnected ? (
        <p className="note">No AI provider configured — authenticate and connect to IDR first.</p>
      ) : models.length > 0 ? (
        <section>
          <h2>Ollama models</h2>
          <ul className="list-plain">
            {models.map((model) => (
              <li key={model}>{model}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {status ? <p className="note">{status}</p> : null}
    </section>
  );
}
