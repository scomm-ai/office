import { useCallback, useState } from "react";
import {
  exportKeyPackageBackup,
  fetchVaultInventory,
  importKeyPackageBackup,
  listVaultTiles,
  syncHostedVault,
  type OfficePubkeySession,
} from "../../../../lib/pubkey-session";

export type KeyPurposeFilter = "all" | "encryption" | "signing";

/** Vault key tiles, directory-coverage check, hosted sync, and single-key package transfer. */
export function useVaultKeys(session: OfficePubkeySession | null, userEmail: string | undefined) {
  const [tiles, setTiles] = useState<Array<Record<string, unknown>>>(() =>
    session ? listVaultTiles(session) : [],
  );
  const [purposeFilter, setPurposeFilter] = useState<KeyPurposeFilter>("all");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [keyPackagePass, setKeyPackagePass] = useState("");
  const [keyPackageJson, setKeyPackageJson] = useState("");

  const refreshTiles = useCallback(() => {
    if (!session) return;
    setTiles(listVaultTiles(session));
  }, [session]);

  const checkCoverage = useCallback(async () => {
    if (!session || !userEmail) return;
    setBusy(true);
    setNote(null);
    try {
      const me = (await fetchVaultInventory(session, userEmail)) as {
        keys?: Array<{ locator?: string }>;
        hosted_record_ids?: string[];
        authorized_devices?: Array<{ status?: string }>;
      };
      const keys = Array.isArray(me.keys) ? me.keys : [];
      const local = new Set(tiles.map((t) => String(t.locator ?? "")));
      const missing = keys.filter((k) => k.locator && !local.has(k.locator));
      const hosted = me.hosted_record_ids?.length ?? 0;
      const authorized = (me.authorized_devices ?? []).some((row) => row.status === "active");
      setNote(
        !authorized
          ? "This Outlook install is not an authorized device. Add this device before syncing."
          : missing.length
            ? `${missing.length} published keys are not on this device${hosted ? ` · ${hosted} records hosted` : ""}`
            : hosted
              ? `This device has every published key · ${hosted} records hosted`
              : "This device has every published key.",
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [session, userEmail, tiles]);

  const syncHosted = useCallback(async () => {
    if (!session || !userEmail) return;
    setBusy(true);
    setNote(null);
    try {
      await syncHostedVault(session, userEmail);
      refreshTiles();
      setNote("Vault synchronized.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [session, userEmail, refreshTiles]);

  const exportPackage = useCallback(async () => {
    if (!session || !keyPackagePass.trim() || tiles.length === 0) return;
    const fingerprint = String(tiles[0]?.fingerprint ?? "");
    if (!fingerprint) return;
    setBusy(true);
    setNote(null);
    try {
      const json = await exportKeyPackageBackup(session, fingerprint, keyPackagePass.trim());
      setKeyPackageJson(json);
      await navigator.clipboard?.writeText(json).catch(() => undefined);
      setNote("Key package copied to clipboard.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [session, keyPackagePass, tiles]);

  const importPackage = useCallback(async () => {
    if (!session || !keyPackagePass.trim() || !keyPackageJson.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      await importKeyPackageBackup(session, keyPackageJson.trim(), keyPackagePass.trim());
      refreshTiles();
      setNote("Key package imported into this Vault.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [session, keyPackagePass, keyPackageJson, refreshTiles]);

  const filteredTiles =
    purposeFilter === "all" ? tiles : tiles.filter((tile) => tile.purpose === purposeFilter);

  return {
    tiles,
    filteredTiles,
    purposeFilter,
    setPurposeFilter,
    busy,
    note,
    refreshTiles,
    checkCoverage,
    syncHosted,
    keyPackagePass,
    setKeyPackagePass,
    keyPackageJson,
    setKeyPackageJson,
    exportPackage,
    importPackage,
  };
}
