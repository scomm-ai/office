import type { PublicKeyDirectory } from "@scomm-office/pubkeys";
import { EcdhEnvelopeControls } from "../../../components/EcdhEnvelopeControls";
import { Button, Divider, Note, Textarea, tokens, usePaneStyles } from "../../../ui/layout";
import { PGP_ADDON_REQUIRED_MESSAGE } from "../../../../lib/billing-pgp";
import type { UseVaultIdentityResult } from "../hooks/useVaultIdentity";
import { VaultBadge } from "../VaultBadge";
import { useVaultStyles } from "../styles";

export function SettingsStatusTab({
  identity,
  directoryLabel,
  pubkeyBase,
  experimentalEncryptionEnabled,
  directory,
  userEmail,
}: {
  identity: UseVaultIdentityResult;
  directoryLabel: string;
  pubkeyBase: string;
  experimentalEncryptionEnabled: boolean;
  directory: PublicKeyDirectory | null;
  userEmail: string | undefined;
}) {
  const styles = usePaneStyles();
  const secStyles = useVaultStyles();
  const verified = identity.status === "verified";

  return (
    <div className={secStyles.screen}>
      <div>
        <div className={secStyles.statusRow}>
          <span className={secStyles.statusLabel}>Identity</span>
          {verified ? (
            <VaultBadge tone="ok">
              Registered on this device{identity.hasPgp ? " · OpenPGP keys published" : ""}
            </VaultBadge>
          ) : (
            <VaultBadge tone="muted">Not set up on this device</VaultBadge>
          )}
        </div>
        <div className={secStyles.statusRow}>
          <span className={secStyles.statusLabel}>Mail encryption</span>
          {identity.engineReady ? (
            <VaultBadge tone="ok">OpenPGP</VaultBadge>
          ) : (
            <VaultBadge tone="muted">OpenPGP engine unavailable</VaultBadge>
          )}
        </div>
        <div className={secStyles.statusRow}>
          <span className={secStyles.statusLabel}>Directory</span>
          <span className={secStyles.statusValue}>{directoryLabel}</span>
        </div>
        <div className={secStyles.statusRow} style={{ borderBottom: "none" }}>
          <span className={secStyles.statusLabel}>Pubkey server</span>
          <span className={secStyles.statusValue}>{pubkeyBase || "— (set in Settings)"}</span>
        </div>
      </div>

      {!identity.pgpEntitled ? <Note>{PGP_ADDON_REQUIRED_MESSAGE}</Note> : null}

      {verified ? (
        <div className={styles.stack}>
          {!identity.directoryArmed ? (
            <div className={styles.stack}>
              <Note>
                A restored Vault is not the same as an armed identity on this pubkey directory. If
                publish fails with "No armed MSK", register the existing key here first.
              </Note>
              <div className={styles.actions}>
                <Button
                  appearance="secondary"
                  size="medium"
                  className={secStyles.actionButton}
                  disabled={identity.busy}
                  onClick={() => void identity.registerOnDirectory()}
                >
                  Register identity on this directory
                </Button>
              </div>
            </div>
          ) : null}
          {/* Once a key is published and the directory is armed, there's nothing to
              do here — the "Identity" row above already says so. Only resurface an
              action when something actually needs attention. */}
          {!identity.hasPgp || !identity.directoryArmed || identity.publishFailed ? (
            <div className={styles.actions}>
              <Button
                appearance={identity.hasPgp ? "secondary" : "primary"}
                size="medium"
                className={secStyles.actionButton}
                disabled={identity.busy || !identity.engineReady || !identity.pgpEntitled}
                onClick={() => void identity.publishPgp()}
              >
                {identity.hasPgp ? "Repair directory keys" : "Publish OpenPGP key"}
              </Button>
            </div>
          ) : null}

          {identity.recoveryCodeResult ? (
            <div className={secStyles.vaultCard}>
              <div className={secStyles.vaultCardHeading}>Your recovery code</div>
              <Note>
                Write this down and store it somewhere safe. It won't be shown again — anyone who
                lost every device would need this code (plus a fresh email verification) to
                restore this vault.
              </Note>
              <Textarea
                readOnly
                value={identity.recoveryCodeResult}
                rows={2}
                style={{ width: "100%", fontFamily: tokens.fontFamilyMonospace }}
              />
              <div className={styles.stack}>
                <Button appearance="primary" size="large" className={secStyles.cta} onClick={identity.dismissRecoveryCode}>
                  I've saved it
                </Button>
              </div>
            </div>
          ) : identity.hasRecoveryEnvelope ? (
            <div className={secStyles.statusRow} style={{ borderBottom: "none" }}>
              <span className={secStyles.statusLabel}>Recovery code</span>
              <VaultBadge tone="ok">Already set up</VaultBadge>
            </div>
          ) : (
            <div className={styles.actions}>
              <Button
                appearance="secondary"
                size="medium"
                className={secStyles.actionButton}
                disabled={identity.busy}
                onClick={() => void identity.setupRecoveryCode()}
              >
                Set up a recovery code
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {identity.statusMessage ? <Note>{identity.statusMessage}</Note> : null}

      {experimentalEncryptionEnabled ? (
        <>
          <Divider />
          <EcdhEnvelopeControls directory={directory} userEmail={userEmail} pgpEntitled={identity.pgpEntitled} />
        </>
      ) : null}
    </div>
  );
}
