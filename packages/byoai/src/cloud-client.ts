import type { CloudAiKeyStore } from "./key-store.js";
import {
  defaultBaseUrlForProvider,
  displayNameForProvider,
  type CloudAiProfile,
  type CloudAiProviderKind,
} from "./types.js";

export { defaultBaseUrlForProvider, displayNameForProvider };
export interface CloudChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CloudChatResult {
  content: string;
  model: string;
}

export class CloudAiClient {
  constructor(
    private readonly keyStore: CloudAiKeyStore,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async testConnection(profile: CloudAiProfile, apiKeyOverride?: string): Promise<boolean> {
    const apiKey = apiKeyOverride?.trim() || (await this.keyStore.readApiKey(profile.id));
    if (!apiKey) {
      return false;
    }
    const base = profile.baseUrl.replace(/\/+$/, "");
    const response = await this.fetchImpl(`${base}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    return response.ok;
  }

  async chat(options: {
    profile: CloudAiProfile;
    messages: CloudChatMessage[];
    apiKeyOverride?: string;
  }): Promise<CloudChatResult> {
    const apiKey =
      options.apiKeyOverride?.trim() || (await this.keyStore.readApiKey(options.profile.id));
    if (!apiKey) {
      throw new Error("Cloud AI API key is not set for this profile.");
    }
    const base = options.profile.baseUrl.replace(/\/+$/, "");
    const response = await this.fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: options.profile.model,
        messages: options.messages,
        temperature: 0.2,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cloud AI request failed (${response.status}): ${text.slice(0, 200)}`);
    }
    const json = (await response.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    return { content, model: json.model ?? options.profile.model };
  }
}

export function createCloudProfile(input: {
  provider?: CloudAiProviderKind;
  model?: string;
  baseUrl?: string;
  name?: string;
  isDefault?: boolean;
}): CloudAiProfile {
  const provider = input.provider ?? "openai";
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `cloud-${Date.now()}`;
  return {
    id,
    name: input.name ?? displayNameForProvider(provider),
    provider,
    baseUrl: input.baseUrl ?? defaultBaseUrlForProvider(provider),
    model: input.model ?? "gpt-4o-mini",
    hasApiKey: false,
    isDefault: input.isDefault ?? false,
  };
}
