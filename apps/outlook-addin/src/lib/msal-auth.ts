import {
  createNestablePublicClientApplication,
  createStandardPublicClientApplication,
  type IPublicClientApplication,
} from "@azure/msal-browser";
import type {
  MicrosoftIdentityProvider,
  MicrosoftUser,
} from "@scomm-office/microsoft-graph";

const CLIENT_ID = import.meta.env.VITE_AZURE_CLIENT_ID ?? "";
const AUTHORITY =
  import.meta.env.VITE_AZURE_AUTHORITY ??
  "https://login.microsoftonline.com/common";

/**
 * Logs only the failure signal — which step failed and the real MSAL error
 * (errorCode/errorMessage), tagged `[Scomm.AI][auth]` so it's greppable in
 * DevTools. This is what actually mattered every time this flow broke; the
 * routine "starting/trying/succeeded" steps in between weren't.
 */
function logFailure(step: string, error: unknown): void {
  const detail =
    error && typeof error === "object"
      ? { errorCode: (error as Record<string, unknown>).errorCode, errorMessage: (error as Record<string, unknown>).errorMessage, name: (error as Record<string, unknown>).name }
      : error;
  console.warn(`[Scomm.AI][auth] ${step}`, detail);
}

function requireClientId(): void {
  if (!CLIENT_ID) {
    throw new Error(
      "VITE_AZURE_CLIENT_ID not configured. Set it in .env to enable Microsoft authentication.",
    );
  }
}

/**
 * MSAL sets a `msal.interaction.status` sessionStorage lock before opening a
 * popup/redirect and clears it when that flow completes. If the flow is
 * interrupted before completion — a redirect URI 404, the popup being closed
 * early, a network blip — the lock is never cleared, and every subsequent
 * interactive call fails immediately with `interaction_in_progress`, even
 * though nothing is actually in progress.
 *
 * We only ever run one interactive flow at a time in this app (each call
 * originates from a single button click), so if we're about to start a new
 * one, any existing lock is necessarily stale — safe to clear unconditionally.
 */
function clearStaleInteractionLock(): void {
  try {
    sessionStorage.removeItem("msal.interaction.status");
  } catch {
    // sessionStorage may be unavailable in some hosts — nothing to clean up then.
  }
}

async function fetchGraphUser(token: string): Promise<MicrosoftUser> {
  const response = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Graph /me failed: ${response.status}`);
  }
  return (await response.json()) as MicrosoftUser;
}

let naaInstance: IPublicClientApplication | null = null;
let naaInitPromise: Promise<IPublicClientApplication> | null = null;

async function getNaaInstance(): Promise<IPublicClientApplication> {
  if (naaInstance) return naaInstance;
  // Without an explicit redirectUri, MSAL falls back to window.location.href,
  // which includes Office.js's own query params on the task pane URL (e.g.
  // _host_Info=...). That doesn't exactly match a registered redirect URI, so
  // Entra rejects it with invalid_request. Only matters when NAA's broker
  // isn't available and it falls back to a real interactive popup (e.g.
  // Outlook on the web) — the broker path itself doesn't hit this.
  const redirectUri = window.location.href.split(/[?#]/)[0];
  naaInitPromise ??= createNestablePublicClientApplication({
    auth: { clientId: CLIENT_ID, authority: AUTHORITY, redirectUri },
  }).then((instance) => {
    naaInstance = instance;
    return instance;
  });
  return naaInitPromise;
}

/**
 * Microsoft Identity Provider using Nested App Authentication (NAA).
 *
 * NAA allows the Outlook add-in to acquire tokens silently through the host
 * Outlook app's authentication broker, avoiding pop-ups. It requires the host
 * to support NestedAppAuth and, in practice, is far more reliable for
 * work/school (Entra ID) accounts than personal Microsoft accounts — see
 * `ResilientIdentityProvider` for the popup-based fallback.
 *
 * IMPORTANT: interactive calls (loginPopup/acquireTokenPopup, which
 * `getGraphToken` falls back to when there's no cached session) must be
 * triggered from a real user gesture (a click handler) — browsers block
 * popups opened from background/init code.
 */
export class NaaIdentityProvider implements MicrosoftIdentityProvider {
  async getUser(): Promise<MicrosoftUser> {
    return fetchGraphUser(await this.getGraphToken(["User.Read"]));
  }

  async getGraphToken(scopes: string[]): Promise<string> {
    requireClientId();
    const pca = await getNaaInstance();

    const accounts = pca.getAllAccounts();
    if (accounts.length > 0) {
      try {
        const silentResult = await pca.acquireTokenSilent({ scopes, account: accounts[0] });
        return silentResult.accessToken;
      } catch {
        // Silent failed — fall through to popup
      }
    }

    clearStaleInteractionLock();
    try {
      const result = await pca.acquireTokenPopup({ scopes });
      return result.accessToken;
    } catch (error) {
      logFailure("NAA: acquireTokenPopup failed", error);
      throw error;
    }
  }

  /** Silent-only: never prompts, never throws — returns null instead. Safe to call at boot. */
  async trySilentToken(scopes: string[]): Promise<string | null> {
    if (!CLIENT_ID) return null;
    try {
      const pca = await getNaaInstance();
      const accounts = pca.getAllAccounts();
      if (accounts.length === 0) return null;
      const result = await pca.acquireTokenSilent({ scopes, account: accounts[0] });
      return result.accessToken;
    } catch {
      return null;
    }
  }
}

let standardInstance: IPublicClientApplication | null = null;
let standardInitPromise: Promise<IPublicClientApplication> | null = null;

async function getStandardInstance(): Promise<IPublicClientApplication> {
  if (standardInstance) return standardInstance;
  // Must be the actual page URL (e.g. https://localhost:5173/taskpane.html), not
  // just window.location.origin — this app has no page at the bare root (Vite
  // serves taskpane.html/commands.html only), so the origin alone 404s when the
  // identity provider redirects the popup back after sign-in.
  const redirectUri = window.location.href.split(/[?#]/)[0];
  // Outlook embeds the task pane in a cross-origin iframe (Outlook's own origin,
  // not ours), which breaks the plain popup flow via COOP/storage partitioning —
  // MSAL's fix is routing through a same-origin top-level "relay" page instead
  // of opening the IdP popup directly from the iframe. See popup-relay.html /
  // src/popup-relay/main.ts.
  const popupRelayUri = `${window.location.origin}/popup-relay.html`;
  standardInitPromise ??= createStandardPublicClientApplication({
    auth: { clientId: CLIENT_ID, authority: AUTHORITY, redirectUri, popupRelayUri },
  }).then((instance) => {
    standardInstance = instance;
    return instance;
  });
  return standardInitPromise;
}

/**
 * Plain (non-nested) MSAL popup authentication.
 *
 * Unlike `NaaIdentityProvider`, this doesn't rely on the Outlook host's
 * authentication broker at all — it opens a real, separate browser popup
 * window to complete a standard OAuth flow. That makes it work identically
 * for personal Microsoft accounts and work/school accounts, and across every
 * Outlook host, at the cost of a visible popup instead of silent brokering.
 *
 * Every method here does interactive auth and MUST be invoked from a user
 * gesture (a click handler) or the browser will block the popup.
 */
export class PopupIdentityProvider implements MicrosoftIdentityProvider {
  async getUser(): Promise<MicrosoftUser> {
    return fetchGraphUser(await this.getGraphToken(["User.Read"]));
  }

  async getGraphToken(scopes: string[]): Promise<string> {
    requireClientId();
    const pca = await getStandardInstance();

    const accounts = pca.getAllAccounts();
    if (accounts.length > 0) {
      try {
        const silentResult = await pca.acquireTokenSilent({ scopes, account: accounts[0] });
        return silentResult.accessToken;
      } catch {
        // Silent failed — fall through to interactive popup
      }
    }

    clearStaleInteractionLock();
    try {
      if (accounts.length === 0) {
        const loginResult = await pca.loginPopup({ scopes });
        return loginResult.accessToken;
      }
      const result = await pca.acquireTokenPopup({ scopes, account: accounts[0] });
      return result.accessToken;
    } catch (error) {
      logFailure("Popup: interactive sign-in failed", error);
      throw error;
    }
  }
}

/**
 * Tries NAA first (silent, then brokered popup); if NAA fails for any reason
 * (unsupported host, personal-account limitations, etc.) falls back to plain
 * MSAL popup auth, which works for any account type. Once NAA fails once in
 * a session, it's skipped on subsequent calls to avoid repeatedly hitting a
 * broker that's already known not to work here.
 *
 * Interactive calls MUST be triggered from a user gesture — see the classes
 * this wraps.
 */
export class ResilientIdentityProvider implements MicrosoftIdentityProvider {
  private readonly naa = new NaaIdentityProvider();
  private readonly popup = new PopupIdentityProvider();
  private naaViable = true;

  async getUser(): Promise<MicrosoftUser> {
    return fetchGraphUser(await this.getGraphToken(["User.Read"]));
  }

  async getGraphToken(scopes: string[]): Promise<string> {
    if (this.naaViable) {
      try {
        return await this.naa.getGraphToken(scopes);
      } catch (error) {
        logFailure("Resilient: NAA failed entirely; switching to popup provider for the rest of this session", error);
        this.naaViable = false;
      }
    }
    return this.popup.getGraphToken(scopes);
  }

  /** Silent-only, never prompts: safe to call at boot for best-effort user discovery. */
  async trySilentUser(): Promise<MicrosoftUser | null> {
    const token = await this.naa.trySilentToken(["User.Read"]);
    if (!token) return null;
    try {
      return await fetchGraphUser(token);
    } catch {
      return null;
    }
  }
}

/** Check if any Microsoft auth (NAA or popup) is configured. */
export function isNaaConfigured(): boolean {
  return Boolean(CLIENT_ID);
}
