import { runPopupRelay } from "@azure/msal-browser/popup-relay";

/**
 * Entry point for the MSAL "popup relay" page (see `auth.popupRelayUri` in
 * msal-auth.ts). MSAL opens this page as a real top-level popup — a plain
 * window.open, not embedded in an iframe — precisely so it can survive
 * Outlook's cross-origin iframe embedding of our task pane, which otherwise
 * breaks the normal popup flow (COOP + third-party storage partitioning).
 *
 * This page's only job: open the actual IdP sign-in as a child popup, wait
 * for that child (running the redirect-bridge in taskpane.html) to report
 * back over BroadcastChannel, then relay the result to the original task
 * pane iframe via window.opener and close itself.
 */
runPopupRelay();
