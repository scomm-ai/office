export type NavModule =
  | "message"
  | "identity"
  | "semantics"
  | "security"
  | "compliance"
  | "idr"
  | "diagnostics"
  | "settings";

const MODULES: Array<{ id: NavModule; label: string }> = [
  { id: "message", label: "Message" },
  { id: "identity", label: "Identity" },
  { id: "semantics", label: "Semantics" },
  { id: "security", label: "Security" },
  { id: "compliance", label: "Compliance" },
  { id: "idr", label: "AI / IDR" },
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
