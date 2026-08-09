export type NavModule =
  | "message"
  | "account"
  | "identity"
  | "semantics"
  | "security"
  | "compliance"
  | "idr"
  | "ai"
  | "diagnostics"
  | "settings";

const MODULES: Array<{ id: NavModule; label: string }> = [
  { id: "message", label: "Message" },
  { id: "account", label: "Account" },
  { id: "identity", label: "Identity" },
  { id: "semantics", label: "Semantics" },
  { id: "security", label: "Security" },
  { id: "compliance", label: "Compliance" },
  { id: "idr", label: "AI / IDR" },
  { id: "ai", label: "BYOAI" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "settings", label: "Settings" },
];

interface NavigationProps {
  active: NavModule;
  onChange: (module: NavModule) => void;
}

export function Navigation({ active, onChange }: NavigationProps) {
  return (
    <nav className="nav" aria-label="SComm modules">
      {MODULES.map((module) => (
        <button
          key={module.id}
          type="button"
          className={active === module.id ? "active" : undefined}
          onClick={() => onChange(module.id)}
        >
          {module.label}
        </button>
      ))}
    </nav>
  );
}
