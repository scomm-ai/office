import { decodeJwtPayloadJson } from "../models/json-utils.js";

export interface BillingAuthTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  tokenType: string;
  expiresInSeconds?: number;
  scope?: string;
}

export function billingAuthTokensFromJwtPluginToken(token: string): BillingAuthTokens {
  const claims = decodeJwtPayloadJson(token);
  let expiresInSeconds: number | undefined;
  if (claims) {
    const exp = claims.exp;
    const expNum = typeof exp === "number" ? exp : typeof exp === "string" ? Number(exp) : NaN;
    if (Number.isFinite(expNum)) {
      const secondsLeft = Math.trunc(expNum) - Math.floor(Date.now() / 1000);
      expiresInSeconds = secondsLeft > 0 ? secondsLeft : 0;
    }
  }
  return {
    accessToken: token,
    tokenType: "Bearer",
    expiresInSeconds,
  };
}

export function billingAuthTokensToJson(tokens: BillingAuthTokens): Record<string, unknown> {
  return {
    access_token: tokens.accessToken,
    ...(tokens.refreshToken ? { refresh_token: tokens.refreshToken } : {}),
    ...(tokens.idToken ? { id_token: tokens.idToken } : {}),
    token_type: tokens.tokenType,
    ...(tokens.expiresInSeconds != null ? { expires_in: tokens.expiresInSeconds } : {}),
    ...(tokens.scope ? { scope: tokens.scope } : {}),
  };
}

export function billingAuthTokensFromJson(json: Record<string, unknown>): BillingAuthTokens {
  const access = json.access_token ?? json.accessToken;
  if (typeof access !== "string" || !access) {
    throw new Error("access_token required.");
  }
  const refresh = json.refresh_token ?? json.refreshToken;
  const idToken = json.id_token ?? json.idToken;
  const expiresIn = json.expires_in ?? json.expiresIn;
  return {
    accessToken: access,
    tokenType: (json.token_type as string | undefined) ?? (json.tokenType as string | undefined) ?? "Bearer",
    ...(typeof refresh === "string" && refresh ? { refreshToken: refresh } : {}),
    ...(typeof idToken === "string" && idToken ? { idToken } : {}),
    ...(typeof expiresIn === "number"
      ? { expiresInSeconds: expiresIn }
      : typeof expiresIn === "string"
        ? { expiresInSeconds: Number.parseInt(expiresIn, 10) }
        : {}),
    ...(typeof json.scope === "string" ? { scope: json.scope } : {}),
  };
}

export interface AuthUserProfile {
  subject?: string;
  email?: string;
  name?: string;
}

export function authUserProfileFromTokens(tokens: BillingAuthTokens): AuthUserProfile {
  const claims =
    decodeJwtPayloadJson(tokens.idToken ?? "") ?? decodeJwtPayloadJson(tokens.accessToken);
  if (!claims) {
    return {};
  }
  return {
    ...(typeof claims.sub === "string" ? { subject: claims.sub } : {}),
    ...(typeof claims.email === "string" ? { email: claims.email } : {}),
    ...(typeof claims.name === "string" ? { name: claims.name } : {}),
  };
}
