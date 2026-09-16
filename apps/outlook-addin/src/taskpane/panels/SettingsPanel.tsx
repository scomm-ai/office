import { useState, type ReactNode } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import {
  ArrowLeft24Regular,
  ChevronRight16Regular,
  DocumentBulletList24Regular,
  MoneyHand24Regular,
  Wrench24Regular,
} from "@fluentui/react-icons";
import { Button, PageTitle, Text, usePaneStyles } from "../ui/layout";
import { ScommAppPromo } from "../components/ScommAppPromo";
import { AccountBillingPanel } from "./AccountBillingPanel";
import { CompliancePanel } from "./CompliancePanel";
import { DiagnosticsPanel } from "./DiagnosticsPanel";

type SettingsEntryId = "account" | "compliance" | "diagnostics";

const ENTRIES: Array<{ id: SettingsEntryId; label: string; description: string; icon: ReactNode }> = [
  {
    id: "account",
    label: "Account & billing",
    description: "License, seats, and this device",
    icon: <MoneyHand24Regular />,
  },
  {
    id: "compliance",
    label: "Compliance",
    description: "Policy checks before you send",
    icon: <DocumentBulletList24Regular />,
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    description: "Host capabilities, for troubleshooting",
    icon: <Wrench24Regular />,
  },
];

const useStyles = makeStyles({
  row: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
    font: "inherit",
    color: "inherit",
  },
  icon: {
    color: tokens.colorNeutralForeground2,
    flexShrink: 0,
  },
  rowBody: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    flex: 1,
    minWidth: 0,
  },
  chevron: {
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  backButton: {
    alignSelf: "flex-start",
    paddingLeft: tokens.spacingHorizontalXS,
    color: tokens.colorNeutralForeground2,
  },
});

/**
 * Settings hub: a short recognizable list of secondary destinations
 * (billing, compliance, diagnostics) instead of separate top-level nav tabs
 * competing with the everyday Message/Identity/Security/AI screens.
 */
export function SettingsPanel() {
  const styles = usePaneStyles();
  const localStyles = useStyles();
  const [subpage, setSubpage] = useState<SettingsEntryId | null>(null);

  if (subpage) {
    // No title here - each panel below already renders its own PageTitle,
    // so this stays a plain back control instead of a duplicate heading.
    return (
      <>
        <Button
          appearance="transparent"
          icon={<ArrowLeft24Regular />}
          onClick={() => setSubpage(null)}
          className={localStyles.backButton}
        >
          Settings
        </Button>
        {subpage === "account" ? <AccountBillingPanel /> : null}
        {subpage === "compliance" ? <CompliancePanel /> : null}
        {subpage === "diagnostics" ? <DiagnosticsPanel /> : null}
      </>
    );
  }

  return (
    <>
      <PageTitle title="Settings" />
      <div className={styles.stack}>
        {ENTRIES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={localStyles.row}
            onClick={() => setSubpage(entry.id)}
          >
            <span className={localStyles.icon}>{entry.icon}</span>
            <span className={localStyles.rowBody}>
              <Text weight="semibold">{entry.label}</Text>
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                {entry.description}
              </Text>
            </span>
            <ChevronRight16Regular className={localStyles.chevron} />
          </button>
        ))}
      </div>
      <ScommAppPromo />
    </>
  );
}
