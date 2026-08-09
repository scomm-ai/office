export class BillingAuthException extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "BillingAuthException";
    this.statusCode = statusCode;
  }
}

export interface BillingOAuthProvidersDocument {
  providers: string[];
  emailPasswordEnabled: boolean;
  raw: Record<string, unknown>;
}

export function parseOAuthProvidersDocument(data: Record<string, unknown>): BillingOAuthProvidersDocument {
  const providersRaw = data.providers ?? data.oauthProviders ?? data.oauth_providers;
  const providers = Array.isArray(providersRaw)
    ? providersRaw.filter((p): p is string => typeof p === "string")
    : [];
  const emailPasswordEnabled = Boolean(
    data.emailPasswordEnabled ?? data.email_password_enabled ?? data.emailAndPassword,
  );
  return { providers, emailPasswordEnabled, raw: data };
}

export class BillingPortalUrls {
  constructor(private readonly portalBaseUrl: string) {}

  private get base(): string {
    return this.portalBaseUrl.endsWith("/")
      ? this.portalBaseUrl.slice(0, -1)
      : this.portalBaseUrl;
  }

  home(accessToken?: string): string {
    if (!accessToken) {
      return this.base;
    }
    const url = new URL(this.base);
    url.searchParams.set("access_token", accessToken);
    return url.toString();
  }

  sessionHandoff(redirectPath?: string): string {
    const url = new URL(`${this.base}/auth/handoff`);
    const redirect = redirectPath?.trim();
    if (redirect && redirect.startsWith("/") && !redirect.startsWith("//")) {
      url.searchParams.set("redirect", redirect);
    }
    return url.toString();
  }
}
