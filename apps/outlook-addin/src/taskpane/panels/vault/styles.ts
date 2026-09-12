import { makeStyles, tokens } from "@fluentui/react-components";

/**
 * Style slots specific to the Vault tab's screens, layered on top of the
 * shared `usePaneStyles`. Kept local to this folder so polishing the Vault
 * UI never changes the look of other task-pane tabs.
 */
export const useVaultStyles = makeStyles({
  header: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    paddingBottom: tokens.spacingVerticalXS,
    marginBottom: tokens.spacingVerticalXXS,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.colorNeutralStroke2,
  },
  headerTitle: {
    flex: 1,
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: "-0.01em",
    color: tokens.colorNeutralForeground1,
  },
  iconButton: {
    minWidth: "28px",
    width: "28px",
    height: "28px",
    padding: 0,
    borderRadius: tokens.borderRadiusMedium,
    color: tokens.colorNeutralForeground2,
  },

  // Vertical rhythm for a whole screen's content — a bit more generous than
  // the shared pane's default stack so sections read as distinct groups.
  screen: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },

  // Screen title + supporting copy, matching the prototype's larger,
  // higher-contrast heading style.
  heading: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  headingTitle: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: "-0.01em",
    color: tokens.colorNeutralForeground1,
    lineHeight: tokens.lineHeightBase500,
  },
  headingDescription: {
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    color: tokens.colorNeutralForeground2,
  },

  // Lighter, more compact badge than the shared filled StatusBadge, which
  // reads as a loud, oversized bar of color in the Vault tab's tighter rows.
  compactBadge: {
    paddingLeft: tokens.spacingHorizontalSNudge,
    paddingRight: tokens.spacingHorizontalSNudge,
    paddingTop: "1px",
    paddingBottom: "1px",
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  statusDot: {
    width: "8px",
    height: "8px",
    borderRadius: tokens.borderRadiusCircular,
    flexShrink: 0,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  nowrap: {
    whiteSpace: "nowrap",
  },
  toggleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    paddingTop: tokens.spacingVerticalS,
    paddingBottom: tokens.spacingVerticalS,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.colorNeutralStroke2,
  },

  // Prototype-style status list row (label left, value right, hairline below).
  statusRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    paddingTop: tokens.spacingVerticalM,
    paddingBottom: tokens.spacingVerticalM,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.colorNeutralStroke2,
  },
  statusRowInteractive: {
    cursor: "pointer",
  },
  statusLabel: {
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2,
  },
  statusValue: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },

  settingsTabs: {
    display: "flex",
    gap: tokens.spacingHorizontalL,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.colorNeutralStroke2,
  },

  otpInput: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase600,
    letterSpacing: "0.14em",
    textAlign: "center",
    height: "48px",
  },

  // Full-width, prominent call-to-action button used for the primary action
  // on a screen (Set up your vault, Finish setup, Restore my keys, ...).
  cta: {
    width: "100%",
    height: "40px",
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    borderRadius: tokens.borderRadiusMedium,
  },
  // Inline action button (Remove, Refresh, Approve a new device, ...).
  actionButton: {
    height: "36px",
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    borderRadius: tokens.borderRadiusMedium,
    paddingLeft: tokens.spacingHorizontalL,
    paddingRight: tokens.spacingHorizontalL,
  },
  // Low-emphasis text-style button (secondary links like "I've lost my code too").
  linkButton: {
    alignSelf: "flex-start",
    paddingLeft: 0,
    paddingRight: 0,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
  },

  warningCard: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    border: `1px solid ${tokens.colorPaletteMarigoldBorder2}`,
    backgroundColor: tokens.colorPaletteMarigoldBackground1,
    borderRadius: tokens.borderRadiusLarge,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
  },
  warningText: {
    color: tokens.colorPaletteDarkOrangeForeground1,
  },
  dangerCard: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    border: `1px solid ${tokens.colorPaletteRedBorder2}`,
    backgroundColor: tokens.colorPaletteRedBackground1,
    borderRadius: tokens.borderRadiusLarge,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
  },
  // Softer neutral card used for recovery codes, key tiles, etc.
  vaultCard: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  vaultCardHeading: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  optionCard: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    cursor: "pointer",
    backgroundColor: tokens.colorNeutralBackground1,
    transitionProperty: "border-color, box-shadow",
    transitionDuration: tokens.durationFaster,
    ":hover": {
      border: `1px solid ${tokens.colorNeutralStroke1}`,
    },
  },
  optionCardTitle: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
});
