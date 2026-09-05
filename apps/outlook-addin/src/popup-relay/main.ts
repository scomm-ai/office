import { runPopupRelay } from "@azure/msal-browser/popup-relay";

/**
 * Entry point for the MSAL "popup relay" page (see `auth.popupRelayUri` in
 * msal-auth.ts). MSAL opens this page as a real top-level popup — a plain
 * window.open, not embedded in an iframe — precisely so it can survive
 * Outlook's cross-origin iframe embedding of our task pane, which otherwise
 * breaks the normal popup flow (COOP + third-party storage partitioning).
 *
 * runPopupRelay() opens the actual Microsoft sign-in as a *second* popup from
 * this page, called directly on load rather than gated behind a click.
 *
 * KNOWN RISK: opening this relay page already consumed the original "user
 * gesture" from the task pane's Apply protection button — some browsers/
 * WebViews only treat the very first window.open() after a click as a
 * genuine user gesture and silently block a second one triggered
 * automatically on load, which MSAL then reports as `user_cancelled` even
 * though no one actually cancelled anything. If that failure mode returns,
 * the fix is re-gating this call behind a real click on this page.
 */
try {
  runPopupRelay();
} catch (error) {
  console.error("[Scomm.AI][auth] Popup relay: runPopupRelay() threw synchronously", error);
}
