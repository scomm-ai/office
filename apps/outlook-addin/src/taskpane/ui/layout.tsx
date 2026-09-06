import type { ReactNode } from "react";
import {
  Badge,
  Button,
  Divider,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Subtitle2,
  Text,
  Textarea,
  Title3,
  makeStyles,
  tokens,
} from "@fluentui/react-components";

/** Task-pane layout tokens (shell, nav, form rows). */
export const usePaneStyles = makeStyles({
  shell: {
    display: "flex",
    flexDirection: "column",
    minHeight: "100%",
    height: "100%",
    backgroundColor: tokens.colorNeutralBackground2,
  },
  header: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.colorNeutralStroke2,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  headerTitle: {
    margin: 0,
  },
  nav: {
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.colorNeutralStroke2,
    backgroundColor: tokens.colorNeutralBackground1,
    display: "flex",
    flexWrap: "wrap",
  },
  panel: {
    flex: 1,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
    alignItems: "center",
  },
  metaGrid: {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    columnGap: tokens.spacingHorizontalM,
    rowGap: tokens.spacingVerticalXXS,
    fontSize: tokens.fontSizeBase200,
  },
  metaLabel: {
    color: tokens.colorNeutralForeground3,
  },
  stack: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  list: {
    margin: 0,
    paddingLeft: tokens.spacingHorizontalL,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  code: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingHorizontalS,
    overflow: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
});

/** Pane title plus optional muted description. */
export function PageTitle({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div>
      <Subtitle2 as="h2" block>
        {title}
      </Subtitle2>
      {description ? (
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {description}
        </Text>
      ) : null}
    </div>
  );
}

/** Grouped block inside a task-pane page. */
export function PaneSection({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  const styles = usePaneStyles();
  return (
    <section className={styles.stack}>
      {title ? (
        <Subtitle2 as="h3" block>
          {title}
        </Subtitle2>
      ) : null}
      {children}
    </section>
  );
}

/** Secondary helper copy. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
      {children}
    </Text>
  );
}

/** Compact status chip (success / warning / danger / muted). */
export function StatusBadge({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "error" | "muted";
  children: ReactNode;
}) {
  const color =
    tone === "ok"
      ? "success"
      : tone === "warn"
        ? "warning"
        : tone === "error"
          ? "danger"
          : "informative";
  return (
    <Badge appearance="filled" color={color} size="small">
      {children}
    </Badge>
  );
}

/**
 * Shared layout helpers and Fluent controls for the Outlook task pane.
 */
export {
  Badge,
  Button,
  Divider,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Subtitle2,
  Text,
  Textarea,
  Title3,
  tokens,
};
