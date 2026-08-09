import { BillingApiClient, type SyncResult, normalizeBillingApiBaseUrl } from "./api/billing-api-client.js";
import { DEFAULT_BILLING_PUBLIC_KEY_PEM } from "./keys/default-public-key.js";
import { decodeJwtAlg } from "./models/json-utils.js";
import type { Plan } from "./models/plan.js";
import type { BillingTokenPayload } from "./models/billing-token-payload.js";
import {
  payloadHasAddon,
  payloadHasPlan,
  payloadHasProduct,
} from "./models/billing-token-payload.js";
import { TokenVerifier, type VerifyResult } from "./verification/token-verifier.js";

/**
 * Client SDK for using-party apps: license sync → offline entitlements → plan catalog.
 * Mirror of Dart `BillingSdk`. Auth lives in `BillingAuthClient`.
 */
export class BillingSdk {
  private static billingApiBaseUrl: string | undefined;
  private static publicKeyPem: string | undefined;
  private static verifier: TokenVerifier | undefined;
  private static apiClient: BillingApiClient | undefined;
  private static currentPayload: BillingTokenPayload | null = null;
  private static loadedKeyFingerprint: string | undefined;
  private static fetchImpl: typeof fetch = fetch;

  static getLoadedKeyFingerprint(): string | undefined {
    return this.loadedKeyFingerprint;
  }

  private static pemFingerprint(pem: string): string {
    const begin = "-----BEGIN PUBLIC KEY-----";
    const end = "-----END PUBLIC KEY-----";
    const start = pem.indexOf(begin);
    const endIdx = pem.indexOf(end);
    if (start < 0 || endIdx <= start) {
      return "?";
    }
    const body = pem
      .slice(start + begin.length, endIdx)
      .replace(/\s/g, "");
    return body.length >= 24 ? body.slice(-24) : body;
  }

  static configure(options: {
    billingApiBaseUrl?: string;
    publicKeyPem?: string;
    fetchImpl?: typeof fetch;
  }): void {
    if (options.billingApiBaseUrl !== undefined) {
      this.billingApiBaseUrl = options.billingApiBaseUrl;
    }
    if (options.publicKeyPem !== undefined) {
      this.publicKeyPem = options.publicKeyPem;
      this.loadedKeyFingerprint = this.pemFingerprint(options.publicKeyPem);
    }
    if (options.fetchImpl) {
      this.fetchImpl = options.fetchImpl;
    }
    this.verifier = undefined;
    this.apiClient = undefined;
  }

  static resetForTesting(): void {
    this.billingApiBaseUrl = undefined;
    this.publicKeyPem = undefined;
    this.verifier = undefined;
    this.apiClient = undefined;
    this.currentPayload = null;
    this.loadedKeyFingerprint = undefined;
    this.fetchImpl = fetch;
  }

  static getJwtAlg(signedToken: string): string | null {
    return decodeJwtAlg(signedToken);
  }

  private static getVerifier(): TokenVerifier {
    return (this.verifier ??= new TokenVerifier(
      this.publicKeyPem ?? DEFAULT_BILLING_PUBLIC_KEY_PEM,
    ));
  }

  private static getApiClient(): BillingApiClient {
    const base = this.billingApiBaseUrl;
    if (!base) {
      throw new Error("BillingSdk: call configure({ billingApiBaseUrl }) before API calls.");
    }
    return (this.apiClient ??= new BillingApiClient(base, this.fetchImpl));
  }

  static async init(savedSignedJson: string | null | undefined): Promise<void> {
    if (!savedSignedJson?.trim()) {
      this.currentPayload = null;
      return;
    }
    const result = await this.getVerifier().verifyAndDecode(savedSignedJson.trim());
    this.currentPayload = result.ok ? result.payload : null;
  }

  static async verifyAndDecode(signedToken: string): Promise<VerifyResult> {
    return this.getVerifier().verifyAndDecode(signedToken);
  }

  static getPayload(): BillingTokenPayload | null {
    return this.currentPayload;
  }

  static hasAddon(addonCode: string): boolean {
    const payload = this.currentPayload;
    return payload ? payloadHasAddon(payload, addonCode) : false;
  }

  static hasPlan(planId: string): boolean {
    const payload = this.currentPayload;
    return payload ? payloadHasPlan(payload, planId) : false;
  }

  static hasProduct(productId: string): boolean {
    const payload = this.currentPayload;
    return payload ? payloadHasProduct(payload, productId) : false;
  }

  static async syncFromServer(options: {
    authorizationToken: string;
    payingPartyId?: string;
    ifNoneMatch?: string;
  }): Promise<SyncResult> {
    const result = await this.getApiClient().fetchLicense(options);
    if (result.kind === "success") {
      await this.init(result.signedToken);
    }
    return result;
  }

  static ensureBillingContext(authorizationToken: string) {
    return this.getApiClient().ensureBillingContext({ authorizationToken });
  }

  static async fetchPlanCatalog(options?: {
    productId?: number;
    billingInterval?: string;
    includeInactive?: boolean;
  }): Promise<Plan[]> {
    return this.getApiClient().fetchPlans(options);
  }

  static normalizeBaseUrl(input: string): string {
    return normalizeBillingApiBaseUrl(input);
  }
}
