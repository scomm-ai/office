/**
 * "ollama" and "lmstudio" are local, on-device runtimes reachable over their
 * OpenAI-compatible endpoints — same wire protocol as "openai_compatible",
 * just with local-friendly defaults and no API key required.
 */
export type CloudAiProviderKind = "openai" | "openai_compatible" | "ollama" | "lmstudio";

export const LOCAL_PROVIDER_KINDS: readonly CloudAiProviderKind[] = ["ollama", "lmstudio"];

export function isLocalProvider(provider: CloudAiProviderKind): boolean {
  return (LOCAL_PROVIDER_KINDS as CloudAiProviderKind[]).includes(provider);
}

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
    case "ollama":
      return "http://localhost:11434/v1";
    case "lmstudio":
      return "http://localhost:1234/v1";
  }
}

export function displayNameForProvider(provider: CloudAiProviderKind): string {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "openai_compatible":
      return "Custom (OpenAI-compatible)";
    case "ollama":
      return "Ollama (local)";
    case "lmstudio":
      return "LM Studio (local)";
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
