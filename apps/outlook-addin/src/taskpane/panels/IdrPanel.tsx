import { useRef, useState } from "react";
import { detectIdrRuntimeSupport, IdrBrowserTransport, OllamaViaIdrProvider } from "@scomm-office/idr";
import { Button, Field, Input, Note, PageTitle, StatusBadge, usePaneStyles } from "../ui/layout";
import { useHostContext } from "../../lib/host-context";

export function IdrPanel() {
  const styles = usePaneStyles();
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
    <>
      <PageTitle
        title="AI / IDR"
        description="IDR is a third-party subscription at idr.to. SComm Office embeds @idrto/idr_browser_sdk only — there is no Office IDR proxy. WebRTC may be unavailable on some Outlook hosts; use HTTPS relay when offered by the SDK."
      />
      <Field label="IDR host">
        <Input
          value={settings.idrTargetHost ?? ""}
          placeholder="your-machine.idr.to"
          onChange={(_, data) => updateSettings({ idrTargetHost: data.value })}
        />
      </Field>
      <Field label="Service">
        <Input
          value={settings.idrDefaultService ?? "ollama"}
          onChange={(_, data) => updateSettings({ idrDefaultService: data.value })}
        />
      </Field>
      <div ref={authMountRef} aria-label="IDR auth mount">
        <Note>IDR auth widget mounts here during interactive authenticate.</Note>
      </div>
      <div className={styles.actions}>
        <Button appearance="primary" size="small" disabled={busy} onClick={() => void authenticate()}>
          Authenticate
        </Button>
        <Button appearance="secondary" size="small" disabled={busy} onClick={() => void testConnection()}>
          Test connection
        </Button>
        <Button appearance="secondary" size="small" disabled={busy} onClick={() => void listModels()}>
          List models
        </Button>
        <Button appearance="secondary" size="small" disabled={busy} onClick={() => void refreshRuntime()}>
          Detect runtime
        </Button>
      </div>
      {idrRuntime ? (
        <dl className={styles.metaGrid}>
          <dt className={styles.metaLabel}>Runtime status</dt>
          <dd>
            <StatusBadge
              tone={
                idrRuntime.status === "supported"
                  ? "ok"
                  : idrRuntime.status === "unsupported"
                    ? "warn"
                    : "error"
              }
            >
              {idrRuntime.status}
            </StatusBadge>
          </dd>
          <dt className={styles.metaLabel}>WebRTC</dt>
          <dd>{idrRuntime.webRtc ? "available" : "unavailable"}</dd>
          <dt className={styles.metaLabel}>Ed25519</dt>
          <dd>{idrRuntime.webCryptoEd25519 ? "available" : "unavailable"}</dd>
        </dl>
      ) : (
        <Note>Runtime support not probed yet.</Note>
      )}
      {!idrConnected ? (
        <Note>No AI provider configured — authenticate and connect to IDR first.</Note>
      ) : models.length > 0 ? (
        <>
          <PageTitle title="Ollama models" />
          <ul className={styles.list}>
            {models.map((model) => (
              <li key={model}>{model}</li>
            ))}
          </ul>
        </>
      ) : null}
      {status ? <Note>{status}</Note> : null}
    </>
  );
}
