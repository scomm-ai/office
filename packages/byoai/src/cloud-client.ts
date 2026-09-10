import type { CloudAiKeyStore } from "./key-store.js";
import {
  defaultBaseUrlForProvider,
  displayNameForProvider,
  isLocalProvider,
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

/** Runs `run(signal)`, aborting after `timeoutMs` (no-op if unset). Always clears the timer. */
async function withTimeout<T>(
  timeoutMs: number | undefined,
  run: (signal: AbortSignal | undefined) => Promise<T>,
): Promise<T> {
  if (!timeoutMs) {
    return run(undefined);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export class CloudAiClient {
  constructor(
    private readonly keyStore: CloudAiKeyStore,
    // Not the bare `fetch` reference: calling it later as `this.fetchImpl(...)`
    // invokes native fetch with the wrong receiver ("Illegal invocation" in
    // real browsers — fetch is receiver-checked like other Window methods).
    // Proxying through a wrapper keeps the call-site correct regardless of
    // how the stored function is later invoked.
    private readonly fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
  ) {}

  async testConnection(
    profile: CloudAiProfile,
    apiKeyOverride?: string,
    options?: { timeoutMs?: number },
  ): Promise<boolean> {
    const apiKey = apiKeyOverride?.trim() || (await this.keyStore.readApiKey(profile.id));
    if (!apiKey && !isLocalProvider(profile.provider)) {
      return false;
    }
    const base = profile.baseUrl.replace(/\/+$/, "");
    try {
      const response = await withTimeout(options?.timeoutMs, (signal) =>
        this.fetchImpl(`${base}/models`, {
          method: "GET",
          headers: {
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            Accept: "application/json",
          },
          signal,
        }),
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Best-effort model list from the OpenAI-compatible `/models` endpoint.
   * Throws on network failure / non-OK response (used to probe whether a
   * local server is running at all) but returns `[]` for an OK response
   * with no models.
   */
  async listModels(
    profile: CloudAiProfile,
    options?: { apiKeyOverride?: string; timeoutMs?: number },
  ): Promise<string[]> {
    const apiKey = options?.apiKeyOverride?.trim() || (await this.keyStore.readApiKey(profile.id));
    const base = profile.baseUrl.replace(/\/+$/, "");
    const response = await withTimeout(options?.timeoutMs, (signal) =>
      this.fetchImpl(`${base}/models`, {
        method: "GET",
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          Accept: "application/json",
        },
        signal,
      }),
    );
    if (!response.ok) {
      throw new Error(`Failed to list models (${response.status})`);
    }
    const json = (await response.json()) as { data?: Array<{ id?: string }> };
    return (json.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  async chat(options: {
    profile: CloudAiProfile;
    messages: CloudChatMessage[];
    apiKeyOverride?: string;
  }): Promise<CloudChatResult> {
    const apiKey =
      options.apiKeyOverride?.trim() || (await this.keyStore.readApiKey(options.profile.id));
    if (!apiKey && !isLocalProvider(options.profile.provider)) {
      throw new Error("Cloud AI API key is not set for this profile.");
    }
    const base = options.profile.baseUrl.replace(/\/+$/, "");
    const response = await this.fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
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

  /**
   * Same as `chat`, but requests SSE streaming (`stream: true`) from the
   * OpenAI-compatible endpoint and invokes `onDelta` as each token chunk
   * arrives, so callers can render the reply incrementally instead of
   * waiting for the full completion. Falls back to a single `onDelta` call
   * with the whole message if the environment's `fetch` doesn't expose a
   * readable response body (e.g. older runtimes).
   */
  async chatStream(options: {
    profile: CloudAiProfile;
    messages: CloudChatMessage[];
    onDelta: (delta: string) => void;
    apiKeyOverride?: string;
    signal?: AbortSignal;
  }): Promise<CloudChatResult> {
    const apiKey =
      options.apiKeyOverride?.trim() || (await this.keyStore.readApiKey(options.profile.id));
    if (!apiKey && !isLocalProvider(options.profile.provider)) {
      throw new Error("Cloud AI API key is not set for this profile.");
    }
    const base = options.profile.baseUrl.replace(/\/+$/, "");
    const response = await this.fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: options.profile.model,
        messages: options.messages,
        temperature: 0.2,
        stream: true,
      }),
      signal: options.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cloud AI request failed (${response.status}): ${text.slice(0, 200)}`);
    }
    if (!response.body) {
      const json = (await response.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content ?? "";
      if (content) {
        options.onDelta(content);
      }
      return { content, model: json.model ?? options.profile.model };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let model = options.profile.model;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const data = trimmed.slice("data:".length).trim();
        if (!data || data === "[DONE]") {
          continue;
        }
        let parsed: { model?: string; choices?: Array<{ delta?: { content?: string } }> };
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        if (parsed.model) {
          model = parsed.model;
        }
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) {
          content += delta;
          options.onDelta(delta);
        }
      }
    }
    return { content, model };
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
