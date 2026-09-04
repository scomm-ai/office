import {
  exchangeOneTimeToken,
  officeSocialStartUrl,
} from "@2key/browser-sdk/auth";
import type { SdkConfig } from "@2key/browser-sdk/billing";
import { subscribeOAuthHandoff } from "./oauth-handoff";

export type OAuthDialogResult =
  | { status: "success"; token: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

type DialogPayload = {
  status?: string;
  ott?: string;
  message?: string;
  error?: string;
};

const DIALOG_TIMEOUT_MS = 120_000;
const HANDOFF_POLL_MS = 400;

export const HTTP_BILLING_SIGNIN_MESSAGE =
  "Outlook cannot open HTTP sign-in windows (error 12005). Set billing origin to https://… — for local billing use HTTPS, or point at https://billing.scomm.ai.";

/**
 * Human-readable Office.js dialog error.
 * 12005 = HTTP URL (Outlook requires HTTPS for displayDialogAsync).
 */
export function officeDialogErrorMessage(code: unknown): string {
  const n = typeof code === "number" ? code : Number(code);
  switch (n) {
    case 12002:
      return "Outlook blocked the sign-in URL. Add your billing origin to the add-in AppDomains and reload.";
    case 12003:
    case 12005:
      return HTTP_BILLING_SIGNIN_MESSAGE;
    case 12004:
      return "Outlook does not trust this sign-in domain. Add the billing origin to AppDomains and reload the add-in.";
    case 12006:
      return "The sign-in window was closed before sign-in finished.";
    case 12007:
      return "A sign-in window is already open. Close it, then try again.";
    case 12009:
      return "Outlook ignored the sign-in click. Allow the window when Outlook asks, then try again.";
    default:
      return `Could not open the sign-in window (code ${code ?? "unknown"}).`;
  }
}

/**
 * Office dialogs must start on the add-in HTTPS origin (`auth-start.html`).
 * Billing may be HTTP; that URL is only followed after the dialog is open.
 */
export function resolveOAuthOpenMode(
  _billingStartUrl: string,
  officeDialogAvailable: boolean,
): "office-dialog" | "browser-popup" {
  return officeDialogAvailable ? "office-dialog" : "browser-popup";
}

/**
 * Same-origin HTTPS page that redirects to billing office-start.html.
 * Outlook forbids passing a cross-origin (and any HTTP) URL to displayDialogAsync.
 */
export function officeHostedDialogStartUrl(billingStartUrl: string, addInOrigin: string): string {
  const start = new URL("auth-start.html", `${addInOrigin.replace(/\/+$/, "")}/`);
  start.searchParams.set("start", billingStartUrl);
  start.searchParams.set("cb", "handoff-poll");
  return start.toString();
}

/**
 * Same-origin popup when Office.dialog is missing (tests / plain browser).
 */
export function officeHostedPopupStartUrl(billingStartUrl: string, addInOrigin: string): string {
  const start = new URL(officeHostedDialogStartUrl(billingStartUrl, addInOrigin));
  start.searchParams.set("mode", "popup");
  return start.toString();
}

/**
 * Poll URL for the OTT. HTTPS add-in → HTTP billing is mixed content, so
 * local HTTP billing uses the Vite same-origin proxy.
 */
export function officeHandoffPollUrl(
  apiBaseUrl: string,
  waitId: string,
  addInOrigin: string,
): string {
  const api = apiBaseUrl.replace(/\/+$/, "");
  const origin = addInOrigin.replace(/\/+$/, "");
  if (api.startsWith("https:")) {
    return `${api}/oauth/office-handoff/${encodeURIComponent(waitId)}`;
  }
  if (origin.startsWith("https:")) {
    return `${origin}/oauth-office-handoff/${encodeURIComponent(waitId)}`;
  }
  return `${api}/oauth/office-handoff/${encodeURIComponent(waitId)}`;
}

/**
 * Billing-hosted start page so the OAuth state cookie is first-party.
 * `return` is this add-in's auth-callback.html (must be a trusted origin).
 */
function buildDialogUrl(config: SdkConfig, provider: string, waitId: string): string {
  const url = new URL(
    officeSocialStartUrl(config, {
      provider,
      returnUrl: `${window.location.origin}/auth-callback.html`,
    }),
  );
  url.searchParams.set("wait", waitId);
  return url.toString();
}

function newOfficeWaitId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function parseHandoffPollBody(body: unknown): DialogPayload | null {
  const root = asRecord(body);
  const data = asRecord(root.data).status ? asRecord(root.data) : root;
  const status = typeof data.status === "string" ? data.status : "";
  if (status === "ready" && typeof data.ott === "string" && data.ott.trim()) {
    return { ott: data.ott.trim() };
  }
  if (status === "failed") {
    return {
      status: "error",
      error: typeof data.error === "string" ? data.error : "sign_in_failed",
    };
  }
  return null;
}

function parseDialogPayload(raw: unknown): DialogPayload {
  if (typeof raw !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as DialogPayload;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return { ott: raw };
  }
}

async function mintFromDialogPayload(
  config: SdkConfig,
  payload: DialogPayload,
): Promise<OAuthDialogResult> {
  if (payload.status === "error" || payload.error) {
    return {
      status: "error",
      message: payload.message || payload.error || "Sign-in failed.",
    };
  }
  const ott = payload.ott?.trim();
  if (!ott) {
    return { status: "error", message: "Sign-in did not return a session handoff token." };
  }
  const minted = await exchangeOneTimeToken(config, ott, { usingParty: true });
  if (minted.orgPickRequired || !minted.token) {
    return {
      status: "error",
      message: "Signed in, but could not open a personal billing context. Try again.",
    };
  }
  return { status: "success", token: minted.token };
}

function deliverPayload(
  config: SdkConfig,
  payload: DialogPayload,
  finish: (result: OAuthDialogResult) => void,
): void {
  void mintFromDialogPayload(config, payload)
    .then(finish)
    .catch((err) => {
      finish({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    });
}

/**
 * localStorage (same WebView) plus billing poll (system browser / COOP).
 */
function watchHandoff(
  config: SdkConfig,
  waitId: string,
  openedAt: number,
  finish: (result: OAuthDialogResult) => void,
): () => void {
  const stopStorage = subscribeOAuthHandoff(openedAt, (raw) => {
    deliverPayload(config, parseDialogPayload(raw), finish);
  });
  const pollUrl = officeHandoffPollUrl(config.apiBaseUrl, waitId, window.location.origin);
  const pollTimer = window.setInterval(() => {
    void (async () => {
      try {
        const res = await fetch(pollUrl, {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "omit",
          cache: "no-store",
        });
        if (!res.ok) {
          return;
        }
        const payload = parseHandoffPollBody(await res.json());
        if (payload) {
          deliverPayload(config, payload, finish);
        }
      } catch {
        /* mixed content or network — keep waiting */
      }
    })();
  }, HANDOFF_POLL_MS);
  return () => {
    stopStorage();
    window.clearInterval(pollTimer);
  };
}

/**
 * Open Better Auth social sign-in in an Office dialog.
 *
 * Call this synchronously from a click handler so Outlook still has the
 * user-gesture. Google/Microsoft cannot run inside an iframe dialog.
 */
export function openOAuthDialog(
  config: SdkConfig,
  provider: string,
): Promise<OAuthDialogResult> {
  const waitId = newOfficeWaitId();
  const billingStartUrl = buildDialogUrl(config, provider, waitId);
  const officeDialogAvailable = Boolean(
    typeof Office !== "undefined" && Office.context?.ui?.displayDialogAsync,
  );

  if (resolveOAuthOpenMode(billingStartUrl, officeDialogAvailable) === "browser-popup") {
    return openBrowserPopup(config, billingStartUrl, waitId);
  }

  const dialogUrl = officeHostedDialogStartUrl(billingStartUrl, window.location.origin);
  const openedAt = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    let dialog: Office.Dialog | undefined;
    let stopHandoff = () => undefined as void;
    const timer = window.setTimeout(() => {
      finish({
        status: "error",
        message: "Sign-in timed out. Close any leftover window and try again.",
      });
    }, DIALOG_TIMEOUT_MS);

    const finish = (result: OAuthDialogResult) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      stopHandoff();
      try {
        dialog?.close();
      } catch {
        /* already closed */
      }
      resolve(result);
    };

    stopHandoff = watchHandoff(config, waitId, openedAt, finish);

    Office.context.ui.displayDialogAsync(
      dialogUrl,
      {
        height: 70,
        width: 40,
        promptBeforeOpen: true,
        displayInIframe: false,
      },
      (asyncResult) => {
        if (asyncResult.status === Office.AsyncResultStatus.Failed) {
          finish({
            status: "error",
            message: officeDialogErrorMessage(asyncResult.error?.code),
          });
          return;
        }

        dialog = asyncResult.value as Office.Dialog;

        dialog.addEventHandler(Office.EventType.DialogEventReceived, (arg) => {
          if (settled) {
            return;
          }
          const code = "error" in arg ? arg.error : undefined;
          if (code === 12007) {
            finish({
              status: "error",
              message: officeDialogErrorMessage(12007),
            });
            return;
          }
          // 12002/12005/12006 fire when the dialog leaves the add-in origin
          // (HTTP billing, Google). Keep polling /oauth/office-handoff.
        });

        dialog.addEventHandler(Office.EventType.DialogMessageReceived, (arg) => {
          deliverPayload(
            config,
            parseDialogPayload("message" in arg ? arg.message : undefined),
            finish,
          );
        });
      },
    );
  });
}

function openBrowserPopup(
  config: SdkConfig,
  billingStartUrl: string,
  waitId: string,
): Promise<OAuthDialogResult> {
  const popupUrl = officeHostedPopupStartUrl(billingStartUrl, window.location.origin);
  const popup = window.open(popupUrl, "_blank", "width=500,height=700");
  if (!popup) {
    return Promise.resolve({
      status: "error",
      message: "The browser blocked the sign-in pop-up. Allow pop-ups for this add-in, then try again.",
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const openedAt = Date.now();
    let stopHandoff = () => undefined as void;
    const finish = (result: OAuthDialogResult) => {
      if (settled) {
        return;
      }
      settled = true;
      stopHandoff();
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      try {
        popup.close();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    stopHandoff = watchHandoff(config, waitId, openedAt, finish);

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const payload = parseDialogPayload(event.data);
      if (!payload.ott && payload.status !== "error" && !payload.error) {
        return;
      }
      deliverPayload(config, payload, finish);
    };

    const timer = window.setTimeout(() => {
      finish({
        status: "error",
        message: "Sign-in timed out. Close any leftover window and try again.",
      });
    }, DIALOG_TIMEOUT_MS);

    window.addEventListener("message", onMessage);
  });
}
