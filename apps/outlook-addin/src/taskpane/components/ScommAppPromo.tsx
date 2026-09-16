import { ArrowRight16Regular, Sparkle20Regular } from "@fluentui/react-icons";
import { makeStyles, tokens } from "@fluentui/react-components";
import { SCOMM_APP_URL } from "../../lib/settings";
import { Button, Text } from "../ui/layout";

const useStyles = makeStyles({
  card: {
    display: "flex",
    alignItems: "flex-start",
    gap: tokens.spacingHorizontalS,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  icon: {
    color: tokens.colorBrandForeground1,
    flexShrink: 0,
    marginTop: "2px",
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
});

/**
 * Contextual, non-blocking pointer to the native Scomm.AI app for people who
 * outgrow the lightweight Outlook add-in. Place sparingly (Settings, Vault
 * settings) - never as an interruption on the main compose/read flow.
 */
export function ScommAppPromo({
  title = "Need the full secure-mail experience?",
  description = "Use Scomm.AI to manage your vault, keys, identity, and advanced security settings more easily.",
}: {
  title?: string;
  description?: string;
}) {
  const styles = useStyles();
  return (
    <div className={styles.card}>
      <Sparkle20Regular className={styles.icon} />
      <div className={styles.body}>
        <Text className={styles.title}>{title}</Text>
        <Text size={200}>{description}</Text>
        <Button
          appearance="secondary"
          size="small"
          icon={<ArrowRight16Regular />}
          iconPosition="after"
          style={{ alignSelf: "flex-start" }}
          onClick={() => window.open(SCOMM_APP_URL, "_blank", "noopener,noreferrer")}
        >
          Open Scomm.AI
        </Button>
      </div>
    </div>
  );
}
