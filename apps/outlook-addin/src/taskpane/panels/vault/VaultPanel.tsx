import { useEffect, useMemo } from "react";
import { ProductionPubkeyDirectory } from "@scomm-office/pubkeys";
import { useHostContext } from "../../../lib/host-context";
import { resolvePubkeyReadBaseUrl, resolvePubkeyWriteBaseUrl } from "../../../lib/settings";
import { getOfficePubkeySession } from "../../../lib/pubkey-session";
import type { TaskPaneCryptoAction } from "../../../lib/taskpane-launch";
import { Button } from "../../ui/layout";
import { useVaultStyles } from "./styles";
import { useVaultRoute } from "./hooks/useVaultRoute";
import { useVaultIdentity } from "./hooks/useVaultIdentity";
import { useVaultDevices } from "./hooks/useVaultDevices";
import { useVaultKeys } from "./hooks/useVaultKeys";
import { useVaultBackup } from "./hooks/useVaultBackup";
import { ReadScreen } from "./screens/ReadScreen";
import { ComposeScreen } from "./screens/ComposeScreen";
import { SetupFlowScreen } from "./screens/SetupFlowScreen";
import { ApproveDeviceScreen } from "./screens/ApproveDeviceScreen";
import { CreateKeyScreen } from "./screens/CreateKeyScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

/**
 * Vault tab: contextual read/compose screens plus a guided setup, device
 * pairing, and recovery flow, and a tabbed Settings (Status/Devices/Keys).
 * Business logic lives in `lib/pubkey-session.ts` and the `hooks/` in this
 * folder — this component only wires screens to that state.
 */
export function VaultPanel({ launchAction = null }: { launchAction?: TaskPaneCryptoAction }) {
  const secStyles = useVaultStyles();
  const { settings, currentUserEmail, isMockHost, message } = useHostContext();
  const userEmail = currentUserEmail ?? (isMockHost ? "muzamiltest9@gmail.com" : undefined);
  const pubkeyBase = resolvePubkeyReadBaseUrl(settings);

  const directory = useMemo(
    () => (pubkeyBase ? new ProductionPubkeyDirectory(pubkeyBase) : null),
    [pubkeyBase],
  );
  const session = useMemo(
    () =>
      pubkeyBase
        ? getOfficePubkeySession({ readBaseUrl: pubkeyBase, writeBaseUrl: resolvePubkeyWriteBaseUrl(settings) })
        : null,
    [pubkeyBase, settings],
  );

  const identity = useVaultIdentity(session, userEmail, settings.billingOrigin);
  const devices = useVaultDevices(session, userEmail);
  const keys = useVaultKeys(session, userEmail);
  const backup = useVaultBackup(session, () => identity.refreshFromVault());

  const composeMode = message?.mode === "compose" || isMockHost;
  const { route, canBack, nav, back } = useVaultRoute(composeMode ? "compose" : "read");

  // Follow the mail item's real mode while the user is on a top-level
  // context screen; leave them alone mid setup/pairing/recovery/settings.
  useEffect(() => {
    if (route !== "read" && route !== "compose") return;
    const next = composeMode ? "compose" : "read";
    if (next !== route) nav(next, { root: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composeMode]);

  const title =
    route === "settings"
      ? "Vault settings"
      : route === "setup"
        ? "Set up encryption"
        : route === "approve"
          ? "Approve a device"
          : route === "create-key"
            ? "Create a key"
            : "Encryption";

  if (!userEmail) {
    return (
      <div className={secStyles.screen}>
        <div className={secStyles.heading}>
          <span className={secStyles.headingTitle}>Vault</span>
          <span className={secStyles.headingDescription}>Current user email unknown — sign in via Microsoft first.</span>
        </div>
      </div>
    );
  }

  return (
    <div className={secStyles.screen}>
      <div className={secStyles.header}>
        {canBack ? (
          <Button appearance="transparent" className={secStyles.iconButton} onClick={back} aria-label="Back">
            ←
          </Button>
        ) : null}
        <span className={secStyles.headerTitle}>{title}</span>
        {route === "read" || route === "compose" ? (
          <Button appearance="transparent" className={secStyles.iconButton} onClick={() => nav("settings")} aria-label="Settings">
            ⚙
          </Button>
        ) : null}
      </div>

      {route === "read" ? (
        <ReadScreen session={session} identity={identity} launchAction={launchAction} onGoSetup={() => nav("setup")} />
      ) : null}
      {route === "compose" ? (
        <ComposeScreen session={session} identity={identity} userEmail={userEmail} onGoSetup={() => nav("setup")} />
      ) : null}
      {route === "setup" ? (
        <SetupFlowScreen identity={identity} userEmail={userEmail} onDone={() => nav(composeMode ? "compose" : "read", { root: true })} />
      ) : null}
      {route === "approve" ? <ApproveDeviceScreen devices={devices} /> : null}
      {route === "create-key" ? (
        <CreateKeyScreen identity={identity} keys={keys} onDone={() => nav("settings")} />
      ) : null}
      {route === "settings" ? (
        <SettingsScreen
          identity={identity}
          devices={devices}
          keys={keys}
          backup={backup}
          directoryLabel={directory ? "GET /v1/keys via @scomm/pubkey" : "—"}
          pubkeyBase={pubkeyBase ?? ""}
          onApproveDevice={() => nav("approve")}
          onCreateKey={() => nav("create-key")}
        />
      ) : null}
    </div>
  );
}
