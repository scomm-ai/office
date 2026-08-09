import type { BillingTokenPayload } from "../models/billing-token-payload.js";
import type { AuthUserProfile, BillingAuthTokens } from "../auth/billing-auth-tokens.js";

export interface BillingAccountSession {
  authTokens?: BillingAuthTokens;
  userProfile?: AuthUserProfile;
  licenseJwt?: string;
  licensePayload?: BillingTokenPayload;
  licenseEtag?: string;
  lastLicenseSyncAt?: string;
  updatedAt: string;
  /** True when authenticated identity owns the paying-party org (portal). */
  isPayingPartyOwner?: boolean;
}

export function canOpenBillingPortal(session: BillingAccountSession | null | undefined): boolean {
  return Boolean(session?.isPayingPartyOwner);
}

export interface BillingSessionStore {
  readAccountSession(accountKey: string): Promise<BillingAccountSession | null>;
  writeAccountSession(accountKey: string, session: BillingAccountSession): Promise<void>;
  deleteAccountSession(accountKey: string): Promise<void>;
  readToken(accountKey: string): Promise<string | null>;
  writeToken(accountKey: string, token: string): Promise<void>;
  deleteToken(accountKey: string): Promise<void>;
}

export class InMemoryBillingSessionStore implements BillingSessionStore {
  private readonly sessions = new Map<string, BillingAccountSession>();
  private readonly tokens = new Map<string, string>();

  async readAccountSession(accountKey: string): Promise<BillingAccountSession | null> {
    return this.sessions.get(accountKey) ?? null;
  }

  async writeAccountSession(accountKey: string, session: BillingAccountSession): Promise<void> {
    this.sessions.set(accountKey, session);
  }

  async deleteAccountSession(accountKey: string): Promise<void> {
    this.sessions.delete(accountKey);
  }

  async readToken(accountKey: string): Promise<string | null> {
    return this.tokens.get(accountKey) ?? null;
  }

  async writeToken(accountKey: string, token: string): Promise<void> {
    this.tokens.set(accountKey, token);
  }

  async deleteToken(accountKey: string): Promise<void> {
    this.tokens.delete(accountKey);
  }
}

const STORAGE_PREFIX = "scomm-office.billing.v1:";

export class LocalStorageBillingSessionStore implements BillingSessionStore {
  constructor(private readonly storage: Storage = localStorage) {}

  private sessionKey(accountKey: string): string {
    return `${STORAGE_PREFIX}session:${accountKey}`;
  }

  private tokenKey(accountKey: string): string {
    return `${STORAGE_PREFIX}token:${accountKey}`;
  }

  async readAccountSession(accountKey: string): Promise<BillingAccountSession | null> {
    try {
      const raw = this.storage.getItem(this.sessionKey(accountKey));
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as BillingAccountSession;
    } catch {
      return null;
    }
  }

  async writeAccountSession(accountKey: string, session: BillingAccountSession): Promise<void> {
    this.storage.setItem(this.sessionKey(accountKey), JSON.stringify(session));
  }

  async deleteAccountSession(accountKey: string): Promise<void> {
    this.storage.removeItem(this.sessionKey(accountKey));
  }

  async readToken(accountKey: string): Promise<string | null> {
    return this.storage.getItem(this.tokenKey(accountKey));
  }

  async writeToken(accountKey: string, token: string): Promise<void> {
    this.storage.setItem(this.tokenKey(accountKey), token);
  }

  async deleteToken(accountKey: string): Promise<void> {
    this.storage.removeItem(this.tokenKey(accountKey));
  }
}
