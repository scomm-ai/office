import { createContext, useContext } from "react";
import type { MailHost } from "@scomm-office/office";
import type { OutlookCapabilities } from "@scomm-office/office";
import type { MailMessage } from "@scomm-office/office";
import type { ResolvedConfiguration } from "@scomm-office/protocol";
import type { SemanticMailDocument } from "@scomm-office/semantics";
import type { PolicyEvaluation, SendDecision } from "@scomm-office/policy";
import type { IdrRuntimeSupport } from "@scomm-office/idr";

export interface AppHostContext {
  mailHost: MailHost;
  capabilities: OutlookCapabilities;
  isMockHost: boolean;
  currentUserEmail?: string;
  message: MailMessage | null;
  semanticDoc: SemanticMailDocument | null;
  policyEvaluation: PolicyEvaluation | null;
  sendDecision: SendDecision | null;
  settings: ResolvedConfiguration;
  idrRuntime: IdrRuntimeSupport | null;
  idrConnected: boolean;
  refreshMessage: () => Promise<void>;
  setSemanticDoc: (doc: SemanticMailDocument | null) => void;
  setPolicyResult: (evaluation: PolicyEvaluation | null, decision: SendDecision | null) => void;
  updateSettings: (patch: Partial<ResolvedConfiguration>) => void;
  setIdrRuntime: (runtime: IdrRuntimeSupport | null) => void;
  setIdrConnected: (connected: boolean) => void;
}

export const HostContext = createContext<AppHostContext | null>(null);

export function useHostContext(): AppHostContext {
  const ctx = useContext(HostContext);
  if (!ctx) {
    throw new Error("HostContext is not available");
  }
  return ctx;
}
