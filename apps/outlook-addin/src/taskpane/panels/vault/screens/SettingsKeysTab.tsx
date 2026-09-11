import { useEffect, useState } from "react";
import {
  Button,
  Field,
  Input,
  Note,
  StatusBadge,
  Textarea,
  tokens,
  usePaneStyles,
} from "../../../ui/layout";
import type { useVaultKeys } from "../hooks/useVaultKeys";
import type { useVaultBackup } from "../hooks/useVaultBackup";

function typeLabel(family: unknown): string {
  const value = String(family ?? "").toLowerCase();
  if (value === "pgp") return "OpenPGP";
  return value ? value.toUpperCase() : "Key";
}

function purposeLabel(purpose: unknown): string {
  const value = String(purpose ?? "");
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "—";
}

export function SettingsKeysTab({
  keys,
  backup,
  onCreateKey,
}: {
  keys: ReturnType<typeof useVaultKeys>;
  backup: ReturnType<typeof useVaultBackup>;
  onCreateKey: () => void;
}) {
  const styles = usePaneStyles();
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    keys.refreshTiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.stack}>
      {keys.tiles.length === 0 ? (
        <Note>No content keys in this device's Vault yet.</Note>
      ) : (
        <div className={styles.stack}>
          {keys.tiles.map((tile) => (
            <div key={String(tile.fingerprint ?? tile.locator)} className={styles.card}>
              <div className={styles.cardHeading}>
                <span>
                  {typeLabel(tile.family)} · {purposeLabel(tile.purpose)}
                </span>
                {tile.status === "active" ? <StatusBadge tone="muted">In use</StatusBadge> : null}
              </div>
              <div>Key ID {String(tile.locator ?? tile.fingerprint ?? "—")}</div>
              <div>{String(tile.algorithm ?? "")}</div>
            </div>
          ))}
        </div>
      )}

      <div className={styles.actions}>
        <Button appearance="secondary" size="small" onClick={() => setShowImport((v) => !v)}>
          Import a key
        </Button>
      </div>

      {showImport ? (
        <div className={styles.stack}>
          <Field label="Key-package password">
            <Input
              type="password"
              value={keys.keyPackagePass}
              onChange={(_, data) => keys.setKeyPackagePass(data.value)}
            />
          </Field>
          <Field label="Key-package JSON">
            <Textarea
              value={keys.keyPackageJson}
              onChange={(_, data) => keys.setKeyPackageJson(data.value)}
              rows={3}
              style={{ width: "100%", fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 }}
            />
          </Field>
          <div className={styles.actions}>
            <Button
              appearance="primary"
              size="small"
              disabled={keys.busy || !keys.keyPackagePass.trim() || !keys.keyPackageJson.trim()}
              onClick={() => void keys.importPackage()}
            >
              Import key package
            </Button>
          </div>
        </div>
      ) : null}

      <Button
        appearance="transparent"
        size="small"
        onClick={onCreateKey}
        style={{ alignSelf: "flex-start", color: tokens.colorNeutralForeground3, paddingLeft: 0 }}
      >
        + Create another key
      </Button>
      <Note>Keys are stored in your encrypted vault and shared with your approved devices only.</Note>

      {keys.note ? <Note>{keys.note}</Note> : null}

      <details>
        <summary style={{ cursor: "pointer", fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold }}>
          Advanced
        </summary>
        <div className={styles.stack} style={{ marginTop: tokens.spacingVerticalS }}>
          <div className={styles.actions}>
            <Button appearance="secondary" size="small" disabled={keys.busy} onClick={() => void keys.checkCoverage()}>
              Check coverage
            </Button>
            <Button appearance="secondary" size="small" disabled={keys.busy} onClick={() => void keys.syncHosted()}>
              Sync vault
            </Button>
          </div>

          <Note>Move a single key to another device with a password-wrapped package.</Note>
          <div className={styles.actions}>
            <Button
              appearance="secondary"
              size="small"
              disabled={keys.busy || !keys.keyPackagePass.trim() || keys.tiles.length === 0}
              onClick={() => void keys.exportPackage()}
            >
              Export key package
            </Button>
          </div>

          <Note>Or back up the whole Vault — IndexedDB alone is not a backup.</Note>
          <Field label="Backup passphrase">
            <Input
              type="password"
              value={backup.passphrase}
              onChange={(_, data) => backup.setPassphrase(data.value)}
            />
          </Field>
          <Field label="Vault backup JSON">
            <Textarea
              value={backup.backupJson}
              onChange={(_, data) => backup.setBackupJson(data.value)}
              rows={4}
              style={{ width: "100%", fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 }}
            />
          </Field>
          <div className={styles.actions}>
            <Button
              appearance="secondary"
              size="small"
              disabled={backup.busy || !backup.passphrase.trim()}
              onClick={() => void backup.exportBackup()}
            >
              Export Vault
            </Button>
            <Button
              appearance="secondary"
              size="small"
              disabled={backup.busy || !backup.passphrase.trim() || !backup.backupJson.trim()}
              onClick={() => void backup.importBackup()}
            >
              Import Vault
            </Button>
          </div>
          {backup.note ? <Note>{backup.note}</Note> : null}
        </div>
      </details>
    </div>
  );
}
