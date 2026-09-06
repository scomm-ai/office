import type { OutlookCapabilities } from "@scomm-office/office";
import { Fragment } from "react";
import { Note, PageTitle, StatusBadge, usePaneStyles } from "../ui/layout";
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
  const styles = usePaneStyles();
  const { capabilities, settings } = useHostContext();

  if (!settings.diagnosticsEnabled) {
    return (
      <>
        <PageTitle title="Diagnostics" />
        <Note>Diagnostics disabled in Settings.</Note>
      </>
    );
  }

  return (
    <>
      <PageTitle
        title="Diagnostics"
        description={`Mailbox requirement set: ${capabilities.mailboxRequirementSet}`}
      />
      <dl className={styles.metaGrid}>
        {CAPABILITY_LABELS.map(({ key, label }) => (
          <Fragment key={key}>
            <dt className={styles.metaLabel}>{label}</dt>
            <dd>
              <StatusBadge tone={capabilities[key] ? "ok" : "muted"}>
                {capabilities[key] ? "true" : "false"}
              </StatusBadge>
            </dd>
          </Fragment>
        ))}
      </dl>
    </>
  );
}
