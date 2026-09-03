import { acquireApiToken } from "@2key/browser-sdk/auth";
import type { SdkConfig } from "@2key/browser-sdk/billing";

export type OAuthDialogResult =
  | { status: "success"; token: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

/**
 * Build a same-origin redirect URL that the Office dialog opens first.
 * The redirect page POSTs to the billing server's social sign-in endpoint
 * and navigates to the OAuth provider.
 */
function buildDialogUrl(config: SdkConfig, provider: string): string {
  const apiBase = config.apiBaseUrl.replace(/\/$/, "");
  const url = new URL("/auth-redirect.html", window.location.origin);
  url.searchParams.set("provider", provider);
  url.searchParams.set("origin", apiBase);
  url.searchParams.set("callbackURL", `${window.location.origin}/auth-callback.html`);
  return url.toString();
}

/**
 * Poll `acquireApiToken` until a session exists (user completed OAuth in dialog).
 * Resolves with the token, or rejects after timeout.
 */
function pollForSession(
  config: SdkConfig,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const intervalMs = 2000;
    const timeoutMs = 120_000;
    let elapsed = 0;

    const check = async () => {
      if (signal.aborted) {
        reject(new Error("cancelled"));
        return;
      }
      try {
        const result = await acquireApiToken(config);
        if (result.token) {
          resolve(result.token);
          return;
        }
      } catch {
        // Not authenticated yet — keep polling
      }
      elapsed += intervalMs;
      if (elapsed >= timeoutMs) {
        reject(new Error("Sign-in timed out. Please try again."));
        return;
      }
      setTimeout(check, intervalMs);
    };

    setTimeout(check, intervalMs);
  });
}

/**
 * Open the Better Auth social sign-in flow inside an Office dialog.
 *
 * 1. Opens `auth-redirect.html` on our origin (same domain — no AppDomains needed)
 * 2. That page POSTs to the billing social sign-in endpoint and navigates to Google/etc.
 * 3. Meanwhile, the taskpane polls `acquireApiToken` every 2s to detect session creation
 * 4. When the user completes OAuth, the billing session cookie is set, polling succeeds
 * 5. Dialog is closed and the token is returned
 */
export function openOAuthDialog(
  config: SdkConfig,
  provider: string,
): Promise<OAuthDialogResult> {
  const dialogUrl = buildDialogUrl(config, provider);

  if (typeof Office === "undefined" || !Office.context?.ui?.displayDialogAsync) {
    window.open(dialogUrl, "_blank", "noopener,noreferrer,width=500,height=700");
    return Promise.resolve({ status: "cancelled" });
  }

  return new Promise((resolve) => {
    const abortController = new AbortController();

    Office.context.ui.displayDialogAsync(
      dialogUrl,
      { height: 60, width: 40, promptBeforeOpen: false },
      (asyncResult) => {
        if (asyncResult.status === Office.AsyncResultStatus.Failed) {
          resolve({
            status: "error",
            message: asyncResult.error?.message ?? "Failed to open sign-in dialog.",
          });
          return;
        }

        const dialog = asyncResult.value as Office.Dialog;

        // Start polling for the billing session
        pollForSession(config, abortController.signal)
          .then((token) => {
            dialog.close();
            resolve({ status: "success", token });
          })
          .catch(() => {
            // Timeout or cancelled — dialog was already closed by user
          });

        // If user closes dialog manually, stop polling
        dialog.addEventHandler(
          Office.EventType.DialogEventReceived,
          (arg) => {
            abortController.abort();
            if ("error" in arg && arg.error === 12006) {
              resolve({ status: "cancelled" });
            } else {
              const code = "error" in arg ? arg.error : "unknown";
              resolve({ status: "error", message: `Dialog closed (code ${code}).` });
            }
          },
        );

        // If auth-callback.html sends a message (fallback), handle it
        dialog.addEventHandler(
          Office.EventType.DialogMessageReceived,
          (arg) => {
            abortController.abort();
            dialog.close();
            resolve({ status: "success", token: "" });
          },
        );
      },
    );
  });
}
