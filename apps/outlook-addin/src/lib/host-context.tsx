import { createContext, useContext } from "react";
import type { MailHost } from "@scomm-office/office";
import type { OutlookCapabilities } from "@scomm-office/office";
import type { MailMessage } from "@scomm-office/office";
import type { ResolvedConfiguration } from "@scomm-office/protocol";
import type { SemanticMailDocument } from "@scomm-office/semantics";
import type { PolicyEvaluation, SendDecision } from "@scomm-office/policy";
import type { IdrRuntimeSupport } from "@scomm-office/idr";
import type { GraphSubmissionAdapter } from "@scomm-office/microsoft-graph";

export interface GraphDiagnostics {
  /** True only if VITE_AZURE_CLIENT_ID was present in the build that produced this bundle. */
  clientIdConfigured: boolean;
  /**
   * Set once an actual Graph send has been attempted — null means never attempted.
   * Deliberately NOT probed automatically at boot: interactive auth (a popup fallback)
   * must come from a real user gesture, so the first real signal is the first send.
   */
  probedSuccessfully: boolean | null;
  /** Human-readable reason Graph submission isn't available, if it isn't. */
  error?: string;
}

export interface AppHostContext {
  mailHost: MailHost;
  capabilities: OutlookCapabilities;
  isMockHost: boolean;
  currentUserEmail?: string;
  /**
   * Set only when Microsoft Graph is configured and reachable (NAA client ID present).
   * When available, compose protection should submit through Graph rather than
   * falling back to Office.js's plain-body submission, which can't build a
   * correctly-headed RFC 822 message from scratch.
   */
  graphSubmissionAdapter: GraphSubmissionAdapter | null;
  /** Why graphSubmissionAdapter is/isn't available — surfaced in the UI for troubleshooting. */
  graphDiagnostics: GraphDiagnostics;
  message: MailMessage | null;
  semanticDoc: SemanticMailDocument | null;
  policyEvaluation: PolicyEvaluation | null;
  sendDecision: SendDecision | null;
  settings: ResolvedConfiguration;
  idrRuntime: IdrRuntimeSupport | null;
  idrConnected: boolean;
  refreshMessage: (reason?: string) => Promise<void>;
  setSemanticDoc: (doc: SemanticMailDocument | null) => void;
  setPolicyResult: (evaluation: PolicyEvaluation | null, decision: SendDecision | null) => void;
  updateSettings: (patch: Partial<ResolvedConfiguration>) => void;
  setIdrRuntime: (runtime: IdrRuntimeSupport | null) => void;
  setIdrConnected: (connected: boolean) => void;
  setGraphDiagnostics: (diagnostics: GraphDiagnostics) => void;
}

export const HostContext = createContext<AppHostContext | null>(null);

export function useHostContext(): AppHostContext {
  const ctx = useContext(HostContext);
  if (!ctx) {
    throw new Error("HostContext is not available");
  }
  return ctx;
}
