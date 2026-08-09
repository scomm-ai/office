import { getKey, parseIntValue } from "./json-utils.js";

export interface Plan {
  id: number;
  productId: number;
  name: string;
  description?: string;
  billingInterval: string;
  basePrice: number;
  currency: string;
  features: string[];
  featuresJson?: Record<string, unknown>;
  addonCode?: string;
  isActive: boolean;
}

export function resolvedAddonCode(plan: Plan): string | undefined {
  if (plan.addonCode) {
    return plan.addonCode;
  }
  const raw = plan.featuresJson?.addonCode;
  return typeof raw === "string" && raw ? raw : undefined;
}

export function planFromJson(j: Record<string, unknown>): Plan {
  const featuresRaw = j.featuresJson ?? j.features_json;
  let features: string[] = [];
  let featuresJson: Record<string, unknown> | undefined;

  if (Array.isArray(featuresRaw)) {
    features = featuresRaw.map(String);
  } else if (typeof featuresRaw === "object" && featuresRaw !== null) {
    featuresJson = featuresRaw as Record<string, unknown>;
    const nested = featuresJson.features;
    if (Array.isArray(nested)) {
      features = nested.map(String);
    }
  }

  const name = j.name;
  if (typeof name !== "string") {
    throw new Error("plan.name required");
  }
  const billingInterval = getKey(j, "billingInterval", "billing_interval");
  const basePrice = getKey(j, "basePrice", "base_price");
  const currency = j.currency;
  if (typeof billingInterval !== "string" || typeof currency !== "string") {
    throw new Error("plan.billingInterval and currency required");
  }
  if (typeof basePrice !== "number") {
    throw new Error("plan.basePrice required");
  }

  const listFeatures = (j.features as string[] | undefined) ?? features;
  const addonCode = (j.addonCode ?? j.addon_code) as string | undefined;
  const isActive = (j.isActive ?? j.is_active) as boolean | undefined;

  return {
    id: parseIntValue(j.id) ?? 0,
    productId: parseIntValue(getKey(j, "productId", "product_id")) ?? 0,
    name,
    ...(typeof j.description === "string" ? { description: j.description } : {}),
    billingInterval,
    basePrice,
    currency,
    features: listFeatures,
    ...(featuresJson ? { featuresJson } : {}),
    ...(typeof addonCode === "string" ? { addonCode } : {}),
    isActive: isActive ?? true,
  };
}
