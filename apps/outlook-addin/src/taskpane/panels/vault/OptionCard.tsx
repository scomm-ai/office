import type { KeyboardEvent, ReactNode } from "react";
import { Note } from "../../ui/layout";
import { useVaultStyles } from "./styles";

/**
 * Clickable, keyboard-operable choice tile shared by the key-type and
 * key-purpose pickers (and any future "pick one of a few options" screen).
 */
export function OptionCard({
  title,
  description,
  busy,
  onSelect,
}: {
  title: string;
  description: ReactNode;
  busy?: boolean;
  onSelect: () => void;
}) {
  const secStyles = useVaultStyles();
  return (
    <div
      className={secStyles.optionCard}
      role="button"
      tabIndex={busy ? -1 : 0}
      aria-disabled={busy}
      onClick={() => !busy && onSelect()}
      onKeyDown={(e: KeyboardEvent) => {
        if (!busy && (e.key === "Enter" || e.key === " ")) onSelect();
      }}
    >
      <span className={secStyles.optionCardTitle}>{title}</span>
      <Note>{description}</Note>
    </div>
  );
}
