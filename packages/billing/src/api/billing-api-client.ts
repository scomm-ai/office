import {
  billingSyncErrorFromHttp,
  billingSyncErrorFromNetwork,
  type BillingSyncError,
} from "../exceptions/billing-sync-error.js";
import { BillingSdkLog } from "../logging/sdk-logger.js";
import { planFromJson, type Plan } from "../models/plan.js";

export type SyncResult =
  | { kind: "success"; signedToken: string; etag?: string }
  | { kind: "notModified"; etag?: string }
  | { kind: "failure"; message: string; error?: BillingSyncError };

export type BootstrapResult =
  | { kind: "success"; stats: PayingPartyBillingStats }
  | { kind: "failure"; message: string; error?: BillingSyncError };

export interface PayingPartyBillingStats {
  payingParty: { id: string; organizationName: string; billingEmail: string };
  hasAssignedSeatForIdentity: boolean;
  raw: Record<string, unknown>;
}

/** Strips trailing `/api/v1` or `/api/billing` so callers may pass origin or API base. */
export function normalizeBillingApiBaseUrl(input: string): string {
  let s = input.trim();
  while (s.endsWith("/")) {
    s = s.slice(0, -1);
  }
  for (const suffix of ["/api/v1", "/api/billing"] as const) {
    if (s.toLowerCase().endsWith(suffix)) {
      s = s.slice(0, -suffix.length);
      while (s.endsWith("/")) {
        s = s.slice(0, -1);
      }
      break;
    }
  }
  return s;
}

function unwrapData(json: Record<string, unknown>): Record<string, unknown> {
  const data = json.data;
  if (typeof data === "object" && data !== null) {
    return data as Record<string, unknown>;
  }
  return json;
}

function unwrapList(json: Record<string, unknown>): unknown[] {
  if (Array.isArray(json.data)) {
    return json.data;
  }
  if (Array.isArray(json.items)) {
    return json.items;
  }
  return [];
}

function readEtag(headers: Headers): string | undefined {
  const raw = headers.get("etag");
  if (!raw) {
    return undefined;
  }
  return raw.replaceAll('"', "").replace(/^W\//, "");
}

function bearer(authorizationToken: string): string {
  const raw = authorizationToken.trim();
  return raw.toLowerCase().startsWith("bearer ") ? raw : `Bearer ${raw}`;
}

export class BillingApiClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const origin = normalizeBillingApiBaseUrl(baseUrl);
    this.baseUrl = origin.endsWith("/") ? origin : `${origin}/`;
  }

  async fetchLicense(options: {
    authorizationToken: string;
    payingPartyId?: string;
    ifNoneMatch?: string;
  }): Promise<SyncResult> {
    const raw = options.authorizationToken.trim();
    if (!raw) {
      BillingSdkLog.warning("fetchLicense: authorization token empty");
      return { kind: "failure", message: "Authorization token is required." };
    }

    const headers: Record<string, string> = { Authorization: bearer(raw) };
    if (options.payingPartyId?.trim()) {
      headers["X-Paying-Party-Id"] = options.payingPartyId.trim();
    }
    if (options.ifNoneMatch?.trim()) {
      const etag = options.ifNoneMatch.trim();
      headers["If-None-Match"] = etag.startsWith('"') ? etag : `"${etag}"`;
    }

    const url = `${this.baseUrl}api/v1/license`;
    BillingSdkLog.info("fetchLicense: GET", url);

    try {
      const response = await this.fetchImpl(url, { method: "GET", headers });
      const responseEtag = readEtag(response.headers);

      if (response.status === 304) {
        BillingSdkLog.info("fetchLicense: not modified (304)");
        return { kind: "notModified", etag: responseEtag ?? options.ifNoneMatch };
      }

      if (response.status === 200) {
        const body = (await response.json()) as Record<string, unknown>;
        const data = unwrapData(body);
        const signed = data.signedToken ?? data.signed_token ?? data.token;
        if (typeof signed === "string" && signed) {
          BillingSdkLog.success("fetchLicense: received signed token", `${signed.length} chars`);
          return { kind: "success", signedToken: signed, etag: responseEtag };
        }
        return {
          kind: "failure",
          message: "Invalid response from billing server. Try again or report this issue.",
          error: {
            kind: "invalidResponse",
            userMessage: "Invalid response from billing server. Try again or report this issue.",
            technicalDetail: "fetchLicense: 200 without signedToken",
          },
        };
      }

      const text = await response.text();
      const err = billingSyncErrorFromHttp({
        statusCode: response.status,
        operation: "fetchLicense",
        responseBody: text,
      });
      return { kind: "failure", message: err.userMessage, error: err };
    } catch (error) {
      const err = billingSyncErrorFromNetwork(error, "fetchLicense");
      return { kind: "failure", message: err.userMessage, error: err };
    }
  }

  async ensureBillingContext(options: {
    authorizationToken: string;
  }): Promise<BootstrapResult> {
    const raw = options.authorizationToken.trim();
    if (!raw) {
      return { kind: "failure", message: "Authorization token is required." };
    }
    const url = `${this.baseUrl}api/v1/subscriptions/me`;
    BillingSdkLog.info("ensureBillingContext: GET", url);

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Authorization: bearer(raw) },
      });
      if (response.status === 200) {
        const body = (await response.json()) as Record<string, unknown>;
        const data = unwrapData(body);
        const partyRaw = (data.payingParty ?? data.paying_party) as
          | Record<string, unknown>
          | undefined;
        if (!partyRaw) {
          return {
            kind: "failure",
            message: "Invalid billing summary response.",
            error: {
              kind: "invalidResponse",
              userMessage: "Invalid billing summary response.",
            },
          };
        }
        return {
          kind: "success",
          stats: {
            payingParty: {
              id: String(partyRaw.id),
              organizationName: String(
                partyRaw.organizationName ?? partyRaw.organization_name ?? "",
              ),
              billingEmail: String(partyRaw.billingEmail ?? partyRaw.billing_email ?? ""),
            },
            hasAssignedSeatForIdentity: Boolean(
              data.hasAssignedSeatForIdentity ?? data.has_assigned_seat_for_identity ?? false,
            ),
            raw: data,
          },
        };
      }
      const text = await response.text();
      const err = billingSyncErrorFromHttp({
        statusCode: response.status,
        operation: "ensureBillingContext",
        responseBody: text,
      });
      return { kind: "failure", message: err.userMessage, error: err };
    } catch (error) {
      const err = billingSyncErrorFromNetwork(error, "ensureBillingContext");
      return { kind: "failure", message: err.userMessage, error: err };
    }
  }

  async fetchPlans(options?: {
    productId?: number;
    billingInterval?: string;
    includeInactive?: boolean;
  }): Promise<Plan[]> {
    const query = new URLSearchParams();
    if (options?.productId != null) {
      query.set("productId", String(options.productId));
    }
    if (options?.billingInterval) {
      query.set("billingInterval", options.billingInterval);
    }
    if (options?.includeInactive) {
      query.set("includeInactive", "true");
    }
    const qs = query.toString();
    const url = `${this.baseUrl}api/v1/plans${qs ? `?${qs}` : ""}`;
    BillingSdkLog.info("fetchPlans: GET", url);

    try {
      const response = await this.fetchImpl(url, { method: "GET" });
      if (response.status !== 200) {
        BillingSdkLog.error(`fetchPlans: HTTP ${response.status}`);
        return [];
      }
      const body = (await response.json()) as Record<string, unknown>;
      return unwrapList(body)
        .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        .map(planFromJson);
    } catch (error) {
      BillingSdkLog.error("fetchPlans: failed", String(error));
      return [];
    }
  }
}
