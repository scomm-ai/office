import { createAuthClient } from "better-auth/client";
import { normalizeBillingApiBaseUrl } from "../api/billing-api-client.js";
import { BillingSdkLog } from "../logging/sdk-logger.js";
import {
  billingAuthTokensFromJwtPluginToken,
  type BillingAuthTokens,
} from "./billing-auth-tokens.js";
import {
  BillingAuthException,
  BillingPortalUrls,
  parseOAuthProvidersDocument,
  type BillingOAuthProvidersDocument,
} from "./billing-auth-types.js";

export type FetchImpl = typeof fetch;

export interface BillingAuthClientOptions {
  billingBaseUrl: string;
  /** Callback URL for social OAuth (task-pane popup / redirect). */
  callbackURL?: string;
  fetchImpl?: FetchImpl;
  /** Optional custom Better Auth base path (default `/api/auth`). */
  basePath?: string;
}

/**
 * Better Auth browser client against the billing host.
 *
 * Office WebViews: prefer email/password or popup social OAuth with `callbackURL`.
 * Session cookies may be restricted; callers can fall back to paste-license-token.
 */
export class BillingAuthClient {
  readonly origin: string;
  readonly authBaseUrl: string;
  readonly callbackURL: string;
  private readonly fetchImpl: FetchImpl;
  private readonly authClient: ReturnType<typeof createAuthClient>;

  constructor(options: BillingAuthClientOptions) {
    this.origin = normalizeBillingApiBaseUrl(options.billingBaseUrl);
    const base = this.origin.endsWith("/") ? this.origin : `${this.origin}/`;
    const basePath = options.basePath ?? "/api/auth";
    this.authBaseUrl = `${base.replace(/\/+$/, "")}${basePath.startsWith("/") ? basePath : `/${basePath}`}`;
    this.callbackURL = options.callbackURL ?? `${typeof window !== "undefined" ? window.location.origin : ""}/auth/callback`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.authClient = createAuthClient({
      baseURL: this.origin,
      basePath,
      fetchOptions: {
        credentials: "include",
      },
    });
  }

  get client(): ReturnType<typeof createAuthClient> {
    return this.authClient;
  }

  async signUpEmail(input: { email: string; password: string; name: string }): Promise<void> {
    const result = await this.authClient.signUp.email(input);
    if (result.error) {
      throw new BillingAuthException(result.error.message ?? "Sign up failed", result.error.status);
    }
  }

  async signInEmail(input: { email: string; password: string }): Promise<void> {
    const result = await this.authClient.signIn.email(input);
    if (result.error) {
      throw new BillingAuthException(result.error.message ?? "Sign in failed", result.error.status);
    }
  }

  async signInSocial(provider: string, callbackURL?: string): Promise<void> {
    const result = await this.authClient.signIn.social({
      provider,
      callbackURL: callbackURL ?? this.callbackURL,
    });
    if (result.error) {
      throw new BillingAuthException(
        result.error.message ?? "Social sign-in failed",
        result.error.status,
      );
    }
  }

  async getSession(): Promise<unknown> {
    const result = await this.authClient.getSession();
    if (result.error) {
      throw new BillingAuthException(
        result.error.message ?? "Could not load session",
        result.error.status,
      );
    }
    return result.data;
  }

  async signOut(): Promise<void> {
    const result = await this.authClient.signOut();
    if (result.error) {
      throw new BillingAuthException(result.error.message ?? "Sign out failed", result.error.status);
    }
  }

  async fetchOAuthProviders(): Promise<BillingOAuthProvidersDocument> {
    const url = `${this.authBaseUrl}/.well-known/oauth-providers`;
    const response = await this.fetchImpl(url, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new BillingAuthException(`Could not load auth providers (${response.status})`, response.status);
    }
    const data = (await response.json()) as Record<string, unknown>;
    return parseOAuthProvidersDocument(data);
  }

  discover(): Promise<BillingOAuthProvidersDocument> {
    return this.fetchOAuthProviders();
  }

  /**
   * Mints a billing API JWT via Better Auth JWT plugin (`GET /api/auth/token`).
   * Relies on session cookies (`credentials: include`).
   */
  async acquireApiToken(): Promise<BillingAuthTokens> {
    const url = `${this.authBaseUrl}/token`;
    const response = await this.fetchImpl(url, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    let body: Record<string, unknown>;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new BillingAuthException(`Invalid token response (${response.status})`, response.status);
    }
    if (!response.ok) {
      throw new BillingAuthException(
        String(body.message ?? body.error ?? `Token mint failed (${response.status})`),
        response.status,
      );
    }
    const token = body.token;
    if (typeof token !== "string" || !token) {
      throw new BillingAuthException("Token response missing token field");
    }
    BillingSdkLog.info("BillingAuthClient: billing JWT minted");
    return billingAuthTokensFromJwtPluginToken(token);
  }

  async refreshApiToken(): Promise<BillingAuthTokens> {
    return this.acquireApiToken();
  }

  createPortalUrls(portalBaseUrl: string): BillingPortalUrls {
    return new BillingPortalUrls(portalBaseUrl);
  }
}
