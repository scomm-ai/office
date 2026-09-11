import type { PublicKeyDirectory } from "@scomm-office/pubkeys";
import { EcdhEnvelopeControls } from "../../../components/EcdhEnvelopeControls";
import { Button, Divider, Note, StatusBadge, Textarea, tokens, usePaneStyles } from "../../../ui/layout";
import { PGP_ADDON_REQUIRED_MESSAGE } from "../../../../lib/billing-pgp";
import type { UseVaultIdentityResult } from "../hooks/useVaultIdentity";

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
  const verified = identity.status === "verified";

  return (
    <div className={styles.stack}>
      <dl className={styles.metaGrid}>
        <dt className={styles.metaLabel}>Identity</dt>
        <dd>
          {verified ? (
            <StatusBadge tone="ok">
              Registered on this device{identity.hasPgp ? " · OpenPGP keys published" : ""}
            </StatusBadge>
          ) : (
            <StatusBadge tone="muted">Not set up on this device</StatusBadge>
          )}
        </dd>
        <dt className={styles.metaLabel}>Mail encryption</dt>
        <dd>
          {identity.engineReady ? (
            <StatusBadge tone="ok">OpenPGP</StatusBadge>
          ) : (
            <StatusBadge tone="muted">OpenPGP engine unavailable</StatusBadge>
          )}
        </dd>
        <dt className={styles.metaLabel}>Directory</dt>
        <dd>{directoryLabel}</dd>
        <dt className={styles.metaLabel}>Pubkey server</dt>
        <dd>{pubkeyBase || "— (set in Settings)"}</dd>
      </dl>

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
                  size="small"
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
                size="small"
                disabled={identity.busy || !identity.engineReady || !identity.pgpEntitled}
                onClick={() => void identity.publishPgp()}
              >
                {identity.hasPgp ? "Repair directory keys" : "Publish OpenPGP key"}
              </Button>
            </div>
          ) : null}

          {identity.recoveryCodeResult ? (
            <div className={styles.card}>
              <div className={styles.cardHeading}>Your recovery code</div>
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
              <div className={styles.actions}>
                <Button appearance="primary" size="small" onClick={identity.dismissRecoveryCode}>
                  I've saved it
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.actions}>
              <Button
                appearance="secondary"
                size="small"
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
