import { useHostContext } from "../../lib/host-context";

export function SecurityPanel() {
  const { settings } = useHostContext();
  const encryptionEnabled = settings.experimentalEncryptionEnabled ?? false;

  return (
    <section>
      <h2>Security</h2>
      <dl className="meta-grid">
        <dt>Encryption</dt>
        <dd>
          <span className={`status ${encryptionEnabled ? "warn" : "muted"}`}>
            {encryptionEnabled ? "experimental (disabled at runtime)" : "disabled"}
          </span>
        </dd>
        <dt>Encryptor</dt>
        <dd>ExperimentalMessageEncryptor (stub)</dd>
        <dt>Decryptor</dt>
        <dd>ExperimentalMessageDecryptor (stub)</dd>
      </dl>
      <p className="note">
        SComm E2EE is not finalized. Both encryptor and decryptor throw UnsupportedFeatureError.
        See openspec/security/e2ee-protocol.md before enabling experimental paths.
      </p>
      <p className="empty">
        Toggle experimental encryption in Settings (informational only — no crypto operations wired).
      </p>
    </section>
  );
}
