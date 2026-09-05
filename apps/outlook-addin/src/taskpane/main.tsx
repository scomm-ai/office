import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

/**
 * True when this page load is actually an MSAL popup/redirect completing an
 * OAuth flow (the hash carries a code/error/state response), not a real task
 * pane load. Deliberately NOT based on `window.opener` — Microsoft's login
 * pages can sever that via Cross-Origin-Opener-Policy during the redirect
 * chain, even though the popup is still a legitimate MSAL flow; the actual
 * completion mechanism (`broadcastResponseToMainFrame`, below) uses a
 * same-origin BroadcastChannel instead, which doesn't depend on `opener`.
 */
function isMsalResponseHash(): boolean {
  return /[#&](code|error|state)=/.test(window.location.hash);
}

if (isMsalResponseHash()) {
  // Don't boot the real add-in here (Office.onReady/mailbox detection makes
  // no sense in a bare auth popup) — instead run MSAL's own redirect-bridge
  // helper, which reads the response from this page's URL and broadcasts it
  // to the window that opened this popup, then closes it.
  import("@azure/msal-browser/redirect-bridge")
    .then(({ broadcastResponseToMainFrame }) => broadcastResponseToMainFrame())
    .catch((error) => {
      console.error("[Scomm.AI][auth] Failed to relay MSAL popup response:", error);
    });
} else {
  const root = document.getElementById("root");
  if (root) {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  }
}
