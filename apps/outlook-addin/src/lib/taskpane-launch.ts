import type { NavModule } from "../taskpane/Navigation";

export type TaskPaneCryptoAction = "decrypt" | "verify" | "encrypt" | "sign" | null;

const MODULES: NavModule[] = [
  "message",
  "account",
  "identity",
  "semantics",
  "security",
  "compliance",
  "idr",
  "ai",
  "diagnostics",
  "settings",
];

export function readTaskPaneLaunch(search = typeof window !== "undefined" ? window.location.search : ""): {
  module: NavModule | null;
  action: TaskPaneCryptoAction;
} {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const rawModule = params.get("module");
  const rawAction = params.get("action");
  const module = MODULES.includes(rawModule as NavModule) ? (rawModule as NavModule) : null;
  const action =
    rawAction === "decrypt" || rawAction === "verify" || rawAction === "encrypt" || rawAction === "sign"
      ? rawAction
      : null;
  return {
    module: module ?? (action ? "security" : null),
    action,
  };
}
