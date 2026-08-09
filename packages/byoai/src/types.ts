export type CloudAiProviderKind = "openai" | "openai_compatible";

export interface CloudAiProfile {
  id: string;
  name: string;
  provider: CloudAiProviderKind;
  baseUrl: string;
  model: string;
  /** Never persist raw key in this object for remote sync — store via CloudAiKeyStore. */
  hasApiKey: boolean;
  isDefault: boolean;
}

export function defaultBaseUrlForProvider(provider: CloudAiProviderKind): string {
  switch (provider) {
    case "openai":
      return "https://api.openai.com/v1";
    case "openai_compatible":
      return "";
  }
}

export function displayNameForProvider(provider: CloudAiProviderKind): string {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "openai_compatible":
      return "Custom (OpenAI-compatible)";
  }
}

export interface LocalAiSettings {
  idrHost: string;
  idrService: string;
  defaultModel: string;
}

export type AiRouteMode = "local" | "cloud" | "none";

export interface ByoaiSettings {
  preferredRoute: AiRouteMode;
  local: LocalAiSettings;
  cloudProfiles: CloudAiProfile[];
}
