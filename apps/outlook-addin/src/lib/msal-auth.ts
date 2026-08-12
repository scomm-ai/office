import {
  createNestablePublicClientApplication,
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

let msalInstance: IPublicClientApplication | null = null;
let msalInitPromise: Promise<IPublicClientApplication> | null = null;

async function getMsalInstance(): Promise<IPublicClientApplication> {
  if (msalInstance) return msalInstance;
  if (msalInitPromise) return msalInitPromise;

  msalInitPromise = createNestablePublicClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: AUTHORITY,
    },
  }).then((instance) => {
    msalInstance = instance;
    return instance;
  });

  return msalInitPromise;
}

/**
 * Microsoft Identity Provider using Nested App Authentication (NAA).
 *
 * NAA allows the Outlook add-in to acquire tokens silently through
 * the host Outlook app's authentication broker, avoiding pop-ups.
 *
 * Requires:
 * - Entra app registration with SPA redirect URI
 * - VITE_AZURE_CLIENT_ID in environment
 * - Outlook host that supports NestedAppAuth 1.1
 */
export class NaaIdentityProvider implements MicrosoftIdentityProvider {
  async getUser(): Promise<MicrosoftUser> {
    const token = await this.getGraphToken(["User.Read"]);
    const response = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Graph /me failed: ${response.status}`);
    }
    return (await response.json()) as MicrosoftUser;
  }

  async getGraphToken(scopes: string[]): Promise<string> {
    if (!CLIENT_ID) {
      throw new Error(
        "VITE_AZURE_CLIENT_ID not configured. Set it in .env to enable Microsoft authentication.",
      );
    }

    const pca = await getMsalInstance();

    // Try silent token acquisition first (cached / SSO)
    const accounts = pca.getAllAccounts();
    if (accounts.length > 0) {
      try {
        const silentResult = await pca.acquireTokenSilent({
          scopes,
          account: accounts[0],
        });
        return silentResult.accessToken;
      } catch {
        // Silent failed — fall through to popup
      }
    }

    // Fall back to popup (interactive)
    const result = await pca.acquireTokenPopup({ scopes });
    return result.accessToken;
  }
}

/**
 * Check if NAA is available and the client ID is configured.
 */
export function isNaaConfigured(): boolean {
  return Boolean(CLIENT_ID);
}
