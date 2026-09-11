import { useCallback, useState } from "react";
import {
  approveDevicePairing,
  listVaultDevices,
  revokeVaultDevice,
  type OfficePubkeySession,
  type VaultDevice,
} from "../../../../lib/pubkey-session";

/** Device listing, revocation, and approving a peer device's pairing code. */
export function useVaultDevices(session: OfficePubkeySession | null, userEmail: string | undefined) {
  const [devices, setDevices] = useState<VaultDevice[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [approveCode, setApproveCode] = useState("");
  const [approving, setApproving] = useState(false);

  const refresh = useCallback(async () => {
    if (!session || !userEmail) return;
    setBusy(true);
    setNote(null);
    try {
      setDevices(await listVaultDevices(session, userEmail));
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [session, userEmail]);

  const remove = useCallback(
    async (deviceId: string) => {
      if (!session || !userEmail) return;
      setBusy(true);
      setNote(null);
      try {
        await revokeVaultDevice(session, userEmail, deviceId);
        await refresh();
      } catch (err) {
        setNote(err instanceof Error ? err.message : String(err));
        setBusy(false);
      }
    },
    [session, userEmail, refresh],
  );

  const approve = useCallback(async () => {
    if (!session || !userEmail || !approveCode.trim()) return;
    setApproving(true);
    setNote(null);
    try {
      await approveDevicePairing(session, userEmail, approveCode.trim());
      setNote("Device approved. Its vault will sync shortly.");
      setApproveCode("");
      await refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setApproving(false);
    }
  }, [session, userEmail, approveCode, refresh]);

  return { devices, busy, note, refresh, remove, approveCode, setApproveCode, approving, approve };
}
