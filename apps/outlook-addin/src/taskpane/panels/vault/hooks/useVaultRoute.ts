import { useCallback, useState } from "react";

export type VaultRoute =
  | "read"
  | "compose"
  | "setup"
  | "keytype"
  | "otp"
  | "done"
  | "pair"
  | "approve"
  | "recover"
  | "reset"
  | "settings"
  | "create-key";

/**
 * Screen navigation for the Vault tab's onboarding/device/recovery flows.
 * A small back-stack, not a router — mirrors the prototype's nav()/goBack()
 * so multi-step flows (setup, pairing, recovery) read the same way here.
 */
export function useVaultRoute(initial: VaultRoute) {
  const [route, setRoute] = useState<VaultRoute>(initial);
  const [stack, setStack] = useState<VaultRoute[]>([]);

  const nav = useCallback((next: VaultRoute, opts?: { root?: boolean }) => {
    setStack((prev) => (opts?.root ? [] : [...prev, route]));
    setRoute(next);
  }, [route]);

  const back = useCallback(() => {
    setStack((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice();
      const last = next.pop();
      if (last) setRoute(last);
      return next;
    });
  }, []);

  return { route, canBack: stack.length > 0, nav, back };
}
