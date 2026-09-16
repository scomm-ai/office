import type { JSX } from "react";
import { Button, tokens } from "@fluentui/react-components";
import {
  Person24Regular,
  Settings24Regular,
  ShieldKeyhole24Regular,
  Sparkle24Regular,
} from "@fluentui/react-icons";
import { usePaneStyles } from "./ui/layout";

// "message" is kept only so an old ?module=message deep link still resolves
// (readTaskPaneLaunch) - it no longer has a screen or a nav button.
export type NavModule =
  | "message"
  | "account"
  | "identity"
  | "security"
  | "compliance"
  | "idr"
  | "ai"
  | "diagnostics"
  | "settings";

// Modules reachable only from inside another screen (the Settings hub, or a
// deep link from the ribbon) - they don't get their own top-level button, so
// the primary nav stays short and recognizable instead of listing every
// screen the add-in has.
const SETTINGS_GROUP: ReadonlySet<NavModule> = new Set(["settings", "account", "compliance", "diagnostics"]);

const PRIMARY_MODULES: Array<{ id: NavModule; label: string; icon: JSX.Element }> = [
  { id: "identity", label: "Identity", icon: <Person24Regular /> },
  { id: "security", label: "Security", icon: <ShieldKeyhole24Regular /> },
  { id: "ai", label: "AI", icon: <Sparkle24Regular /> },
  { id: "settings", label: "Settings", icon: <Settings24Regular /> },
];

interface NavigationProps {
  active: NavModule;
  onChange: (module: NavModule) => void;
}

export function Navigation({ active, onChange }: NavigationProps) {
  const styles = usePaneStyles();
  // "idr" folds into the AI tab's advanced section; anything in the Settings
  // group (including its sub-pages) reads as the Settings tab being active;
  // "message" no longer has a screen of its own, so it reads as Security.
  const effectiveActive =
    active === "idr" ? "ai" : active === "message" ? "security" : SETTINGS_GROUP.has(active) ? "settings" : active;

  return (
    <nav className={styles.nav} aria-label="SComm modules">
      {PRIMARY_MODULES.map((module) => (
        <Button
          key={module.id}
          appearance={effectiveActive === module.id ? "primary" : "subtle"}
          size="small"
          icon={module.icon}
          onClick={() => onChange(module.id)}
          style={{ gap: tokens.spacingHorizontalXXS }}
        >
          {module.label}
        </Button>
      ))}
    </nav>
  );
}
