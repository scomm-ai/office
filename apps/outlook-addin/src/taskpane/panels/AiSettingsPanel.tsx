import { useState } from "react";
import { isLocalProvider } from "@scomm-office/byoai";
import { loadProfiles } from "../../lib/byoai-profiles";
import { AiSetupView } from "./AiSetupView";
import { AiChatView } from "./AiChatView";

function hasWorkingProvider(): boolean {
  return loadProfiles().some((p) => p.hasApiKey || isLocalProvider(p.provider));
}

/**
 * Soft gate: opens straight to Chat when a working provider (external with a
 * saved key, or a local server) already exists; otherwise starts at Setup and
 * hands off to Chat once a connection test passes. Either screen is reachable
 * from the other at any time.
 */
export function AiSettingsPanel() {
  const [view, setView] = useState<"setup" | "chat">(() => (hasWorkingProvider() ? "chat" : "setup"));

  return view === "setup" ? (
    <AiSetupView onReady={() => setView("chat")} />
  ) : (
    <AiChatView onOpenSetup={() => setView("setup")} />
  );
}
