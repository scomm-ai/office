import { useCallback, useState } from "react";
import { errorMessage } from "../../../../lib/error-message";
import {
  exportVaultBackup,
  importVaultBackup,
  restoreOfficeVault,
  type OfficePubkeySession,
} from "../../../../lib/pubkey-session";

/** Whole-vault passphrase-wrapped JSON backup/restore. */
export function useVaultBackup(
  session: OfficePubkeySession | null,
  onRestored?: (hasPgp: boolean) => void,
) {
  const [passphrase, setPassphrase] = useState("");
  const [backupJson, setBackupJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const exportBackup = useCallback(async () => {
    if (!session || !passphrase.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const json = await exportVaultBackup(session, passphrase.trim());
      setBackupJson(json);
      setNote("Vault exported. Store this JSON and passphrase offline.");
    } catch (err) {
      setNote(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [session, passphrase]);

  const importBackup = useCallback(async () => {
    if (!session || !passphrase.trim() || !backupJson.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      await importVaultBackup(session, backupJson.trim(), passphrase.trim());
      const state = await restoreOfficeVault(session);
      onRestored?.(state.hasPgp);
      setNote("Vault imported from passphrase backup.");
    } catch (err) {
      setNote(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [session, passphrase, backupJson, onRestored]);

  return { passphrase, setPassphrase, backupJson, setBackupJson, busy, note, exportBackup, importBackup };
}
