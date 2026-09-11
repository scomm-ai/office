import { makeStyles, tokens } from "@fluentui/react-components";

/** Style slots specific to the Vault tab's screens, layered on top of the shared `usePaneStyles`. */
export const useVaultStyles = makeStyles({
  header: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
  headerTitle: {
    flex: 1,
  },
  statusDot: {
    width: "7px",
    height: "7px",
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
    paddingTop: tokens.spacingVerticalXS,
    paddingBottom: tokens.spacingVerticalXS,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.colorNeutralStroke2,
  },
  settingsTabs: {
    display: "flex",
    gap: tokens.spacingHorizontalM,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.colorNeutralStroke2,
  },
  otpInput: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase500,
    letterSpacing: "0.12em",
    textAlign: "center",
  },
  warningCard: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    border: `1px solid ${tokens.colorPaletteMarigoldBorder2}`,
    backgroundColor: tokens.colorPaletteMarigoldBackground1,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingHorizontalM,
  },
  warningText: {
    color: tokens.colorPaletteDarkOrangeForeground1,
  },
  dangerCard: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    border: `1px solid ${tokens.colorPaletteRedBorder2}`,
    backgroundColor: tokens.colorPaletteRedBackground1,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingHorizontalM,
  },
  optionCard: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingHorizontalM,
    cursor: "pointer",
  },
});
