import { BillingSdk } from "../billing-sdk.js";
import type { BillingSyncError } from "../exceptions/billing-sync-error.js";
import {
  authUserProfileFromTokens,
  type BillingAuthTokens,
} from "../auth/billing-auth-tokens.js";
import {
  canOpenBillingPortal,
  type BillingAccountSession,
  type BillingSessionStore,
} from "./billing-session-store.js";
import {
  BILLING_ADDON_AI_ASSISTANT,
  payloadHasAddon,
  type BillingTokenPayload,
} from "../models/billing-token-payload.js";

export type SessionSyncOutcome =
  | { kind: "success"; session: BillingAccountSession; message: string }
  | { kind: "failure"; message: string; error?: BillingSyncError };

export type SessionVerifyOutcome =
  | { kind: "success"; message: string }
  | { kind: "failure"; message: string };

export const DEFAULT_LICENSE_POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function shouldPollLicenseEntitlements(session: BillingAccountSession | null): boolean {
  if (!session) {
    return false;
  }
  if (session.licensePayload?.subscriptions.length) {
    return true;
  }
  return Boolean(session.licenseJwt);
}

export class BillingSession {
  private cachedSession: BillingAccountSession | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollingAccountKey: string | null = null;
  private pollInFlight = false;

  constructor(private readonly store: BillingSessionStore) {}

  get payload(): BillingTokenPayload | null {
    return BillingSdk.getPayload();
  }

  get accountSession(): BillingAccountSession | null {
    return this.cachedSession;
  }

  get isLicensePollingActive(): boolean {
    return this.pollTimer !== null;
  }

  async initForAccount(accountKey: string): Promise<BillingAccountSession | null> {
    let session = await this.store.readAccountSession(accountKey);
    this.cachedSession = session;
    if (session?.licenseJwt) {
      await BillingSdk.init(session.licenseJwt);
    } else {
      const legacy = await this.store.readToken(accountKey);
      await BillingSdk.init(legacy);
    }
    return session;
  }

  async persistAuthTokens(options: {
    accountKey: string;
    tokens: BillingAuthTokens;
  }): Promise<BillingAccountSession> {
    const profile = authUserProfileFromTokens(options.tokens);
    const session: BillingAccountSession = {
      authTokens: options.tokens,
      userProfile: profile,
      updatedAt: new Date().toISOString(),
    };
    await this.store.writeAccountSession(options.accountKey, session);
    this.cachedSession = session;
    return session;
  }

  async persistLicense(options: {
    accountKey: string;
    licenseJwt: string;
    baseSession?: BillingAccountSession;
    licenseEtag?: string;
  }): Promise<void> {
    await BillingSdk.init(options.licenseJwt);
    const payload = BillingSdk.getPayload();
    const current = options.baseSession ?? this.cachedSession;
    if (!current) {
      await this.store.writeToken(options.accountKey, options.licenseJwt);
      return;
    }
    const now = new Date().toISOString();
    const updated: BillingAccountSession = {
      ...current,
      licenseJwt: options.licenseJwt,
      ...(payload ? { licensePayload: payload } : {}),
      ...(options.licenseEtag ? { licenseEtag: options.licenseEtag } : {}),
      lastLicenseSyncAt: now,
      updatedAt: now,
    };
    await this.store.writeAccountSession(options.accountKey, updated);
    await this.store.writeToken(options.accountKey, options.licenseJwt);
    this.cachedSession = updated;
  }

  async clearAccount(accountKey: string): Promise<void> {
    this.stopLicensePolling();
    await this.store.deleteAccountSession(accountKey);
    await this.store.deleteToken(accountKey);
    this.cachedSession = null;
    await BillingSdk.init(null);
  }

  async verifyOfflineToken(options: {
    accountKey: string;
    token: string;
  }): Promise<SessionVerifyOutcome> {
    const trimmed = options.token.trim();
    if (!trimmed) {
      return { kind: "failure", message: "Paste a billing token first." };
    }
    const result = await BillingSdk.verifyAndDecode(trimmed);
    if (!result.ok) {
      return { kind: "failure", message: result.error.message };
    }
    await this.persistLicense({ accountKey: options.accountKey, licenseJwt: trimmed });
    return { kind: "success", message: "License token verified and saved." };
  }

  async syncOnlineForAccount(options: {
    accountKey: string;
    payingPartyId?: string;
  }): Promise<SessionSyncOutcome> {
    const session = this.cachedSession ?? (await this.store.readAccountSession(options.accountKey));
    const accessToken = session?.authTokens?.accessToken;
    if (!accessToken) {
      return { kind: "failure", message: "Sign in before syncing license." };
    }
    const sync = await BillingSdk.syncFromServer({
      authorizationToken: accessToken,
      payingPartyId: options.payingPartyId,
      ifNoneMatch: session?.licenseEtag,
    });
    if (sync.kind === "failure") {
      return { kind: "failure", message: sync.message, error: sync.error };
    }
    if (sync.kind === "notModified") {
      const current = session ?? { updatedAt: new Date().toISOString() };
      this.cachedSession = current;
      return {
        kind: "success",
        session: current,
        message: "Subscription data unchanged.",
      };
    }
    await this.persistLicense({
      accountKey: options.accountKey,
      licenseJwt: sync.signedToken,
      baseSession: session ?? undefined,
      licenseEtag: sync.etag,
    });
    return {
      kind: "success",
      session: this.cachedSession!,
      message: "Subscription data updated.",
    };
  }

  startLicensePolling(accountKey: string, intervalMs = DEFAULT_LICENSE_POLL_INTERVAL_MS): void {
    this.stopLicensePolling();
    if (!shouldPollLicenseEntitlements(this.cachedSession)) {
      return;
    }
    this.pollingAccountKey = accountKey;
    this.pollTimer = setInterval(() => {
      if (this.pollInFlight || !this.pollingAccountKey) {
        return;
      }
      this.pollInFlight = true;
      void this.syncOnlineForAccount({ accountKey: this.pollingAccountKey }).finally(() => {
        this.pollInFlight = false;
      });
    }, intervalMs);
  }

  stopLicensePolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollingAccountKey = null;
  }

  hasAiAssistantEntitlement(payload: BillingTokenPayload | null = this.payload): boolean {
    if (!payload) {
      return false;
    }
    return payloadHasAddon(payload, BILLING_ADDON_AI_ASSISTANT);
  }

  canOpenPortal(): boolean {
    return canOpenBillingPortal(this.cachedSession);
  }
}
