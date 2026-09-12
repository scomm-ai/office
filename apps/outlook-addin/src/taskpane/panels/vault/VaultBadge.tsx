import type { ReactNode } from "react";
import { Badge } from "@fluentui/react-components";
import { useVaultStyles } from "./styles";

/**
 * Vault-tab status badge — same tone API as the shared `StatusBadge`, but
 * rendered with the lighter "tint" appearance and tighter padding. The
 * shared component's "filled" appearance reads as a loud, oversized bar of
 * solid color in the Vault tab's compact rows, so this stays local rather
 * than changing that look for every other tab.
 */
export function VaultBadge({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "error" | "muted";
  children: ReactNode;
}) {
  const styles = useVaultStyles();
  const color =
    tone === "ok"
      ? "success"
      : tone === "warn"
        ? "warning"
        : tone === "error"
          ? "danger"
          : "informative";
  return (
    <Badge appearance="tint" color={color} size="small" className={styles.compactBadge}>
      {children}
    </Badge>
  );
}
