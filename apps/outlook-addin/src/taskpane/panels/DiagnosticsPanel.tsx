import type { OutlookCapabilities } from "@scomm-office/office";
import { Fragment } from "react";
import { useHostContext } from "../../lib/host-context";

const CAPABILITY_LABELS: Array<{
  key: keyof Omit<OutlookCapabilities, "mailboxRequirementSet">;
  label: string;
}> = [
    { key: "internetHeaders", label: "Internet headers (Mailbox 1.8+)" },
    { key: "eventBasedActivation", label: "Event-based activation (1.12+)" },
    { key: "onMessageCompose", label: "OnMessageCompose" },
    { key: "onMessageSend", label: "OnMessageSend" },
    { key: "smartAlerts", label: "Smart Alerts" },
    { key: "onMessageDecrypt", label: "OnMessageDecrypt" },
    { key: "attachments", label: "Attachments API (Mailbox 1.8+)" },
    { key: "signatureApi", label: "Signature API" },
    { key: "nestedAppAuthentication", label: "Nested App Authentication" },
    { key: "webRtc", label: "WebRTC" },
    { key: "webCryptoEd25519", label: "WebCrypto Ed25519" },
  ];

export function DiagnosticsPanel() {
  const { capabilities, settings } = useHostContext();

  if (!settings.diagnosticsEnabled) {
    return (
      <section>
        <h2>Diagnostics</h2>
        <p className="empty">Diagnostics disabled in Settings.</p>
      </section>
    );
  }

  return (
    <section>
      <h2>Diagnostics</h2>
      <p className="note">Mailbox requirement set: {capabilities.mailboxRequirementSet}</p>
      <div className="cap-grid">
        {CAPABILITY_LABELS.map(({ key, label }) => (
          <Fragment key={key}>
            <span>{label}</span>
            <span className={`status ${capabilities[key] ? "ok" : "muted"}`}>
              {capabilities[key] ? "true" : "false"}
            </span>
          </Fragment>
        ))}
      </div>
    </section>
  );
}
