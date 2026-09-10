import { describe, expect, it, vi } from "vitest";
import { createCloudProfile, displayNameForProvider, CloudAiClient } from "./cloud-client.js";
import { BILLING_ADDON_AI_ASSISTANT, hasAiEntitlement } from "./entitlements.js";
import { buildEmailContextMessage, extractProposedDraft } from "./context.js";
import { isLocalProvider } from "./types.js";
import { InMemoryCloudAiKeyStore } from "./key-store.js";
import type { CloudAiKeyStore } from "./key-store.js";
import type { CloudAiProfile, ByoaiSettings } from "./types.js";

// @scomm-office/idr's barrel also exports a browser-only transport that touches
// HTMLElement at module load; only the local-AI branch of ByoaiRouter needs it,
// which these cloud-routing tests never exercise, so stub it out for the node test env.
vi.mock("@scomm-office/idr", () => ({
  OllamaViaIdrProvider: class {
    generate(): never {
      throw new Error("not used in these tests");
    }
  },
}));
const { ByoaiRouter } = await import("./router.js");

describe("createCloudProfile", () => {
  it("defaults openai base URL", () => {
    const profile = createCloudProfile({});
    expect(profile.provider).toBe("openai");
    expect(profile.baseUrl).toContain("api.openai.com");
    expect(profile.name).toBe(displayNameForProvider("openai"));
  });
});

describe("hasAiEntitlement", () => {
  it("requires ai_assistant add-on by default", () => {
    expect(hasAiEntitlement(null)).toBe(false);
    expect(
      hasAiEntitlement({
        hasAddon: (code) => code === BILLING_ADDON_AI_ASSISTANT,
      }),
    ).toBe(true);
    expect(
      hasAiEntitlement({
        hasAddon: () => false,
        hasOffering: (code) => code === BILLING_ADDON_AI_ASSISTANT,
      }),
    ).toBe(true);
  });
});

describe("buildEmailContextMessage", () => {
  it("labels compose mode and includes the draft-block instruction", () => {
    const message = buildEmailContextMessage({
      mode: "compose",
      subject: "Re: Project update",
      bodyText: "Hi team,\n\nHere's the status.",
      from: { emailAddress: "me@example.com" },
      to: [{ emailAddress: "you@example.com", displayName: "You" }],
    });
    expect(message.role).toBe("system");
    expect(message.content).toContain("compose an email");
    expect(message.content).toContain("Subject: Re: Project update");
    expect(message.content).toContain("You <you@example.com>");
    expect(message.content).toContain("<<<DRAFT>>>");
  });

  it("labels read mode and omits the draft-block instruction", () => {
    const message = buildEmailContextMessage({ mode: "read", subject: "Hello" });
    expect(message.content).toContain("read an email");
    expect(message.content).not.toContain("<<<DRAFT>>>");
  });
});

describe("extractProposedDraft", () => {
  it("extracts the body between well-formed draft markers", () => {
    const content = "Sure, here you go:\n\n<<<DRAFT>>>\nHi there,\nBest,\nMe\n<<<END>>>\n\nLet me know!";
    expect(extractProposedDraft(content)).toBe("Hi there,\nBest,\nMe");
  });

  it("returns null when no draft block is present", () => {
    expect(extractProposedDraft("Just a normal reply.")).toBeNull();
  });

  // Regression coverage for a real gemma3:1b response captured during manual
  // e2e testing against a local Ollama server: the model put the body on the
  // same line as the opening marker and never emitted a closing marker.
  it("handles the marker and body on the same line with no closing marker", () => {
    const content = "<<<DRAFT>>> Hi, thanks for reaching out. Best, Sam";
    expect(extractProposedDraft(content)).toBe("Hi, thanks for reaching out. Best, Sam");
  });

  it("returns null for an empty draft block", () => {
    expect(extractProposedDraft("<<<DRAFT>>>\n\n<<<END>>>")).toBeNull();
  });
});

describe("ByoaiRouter.chat", () => {
  const settings: ByoaiSettings = {
    preferredRoute: "cloud",
    local: { idrHost: "", idrService: "ollama", defaultModel: "" },
    cloudProfiles: [createCloudProfile({ isDefault: true })],
  };
  const keyStore: CloudAiKeyStore = {
    readApiKey: vi.fn().mockResolvedValue("sk-test"),
    writeApiKey: vi.fn(),
    deleteApiKey: vi.fn(),
  };

  it("routes to the cloud client with the full message history", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ model: "gpt-4o-mini", choices: [{ message: { content: "Hi!" } }] }),
    });
    const cloudClient = new CloudAiClient(keyStore, fetchImpl as unknown as typeof fetch);
    const router = new ByoaiRouter(
      settings,
      cloudClient,
      () => null,
      () => ({ hasAddon: () => true }),
    );
    const reply = await router.chat([{ role: "user", content: "Draft a reply" }]);
    expect(reply).toBe("Hi!");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws when entitlement is missing", async () => {
    const cloudClient = new CloudAiClient(keyStore);
    const router = new ByoaiRouter(
      settings,
      cloudClient,
      () => null,
      () => null,
    );
    await expect(router.chat([{ role: "user", content: "hi" }])).rejects.toThrow(/ai_assistant/);
  });
});

describe("isLocalProvider", () => {
  it("treats ollama and lmstudio as local, others as external", () => {
    expect(isLocalProvider("ollama")).toBe(true);
    expect(isLocalProvider("lmstudio")).toBe(true);
    expect(isLocalProvider("openai")).toBe(false);
    expect(isLocalProvider("openai_compatible")).toBe(false);
  });
});

describe("CloudAiClient.testConnection", () => {
  it("requires a key for external providers but not for local ones", async () => {
    const emptyKeyStore = new InMemoryCloudAiKeyStore();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    const client = new CloudAiClient(emptyKeyStore, fetchImpl as unknown as typeof fetch);

    const external: CloudAiProfile = createCloudProfile({ provider: "openai" });
    expect(await client.testConnection(external)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();

    const local: CloudAiProfile = createCloudProfile({ provider: "ollama", baseUrl: "http://localhost:11434/v1" });
    expect(await client.testConnection(local)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:11434/v1/models",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns false instead of throwing when the fetch rejects (e.g. connection refused)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new CloudAiClient(new InMemoryCloudAiKeyStore(), fetchImpl as unknown as typeof fetch);
    const local = createCloudProfile({ provider: "ollama" });
    expect(await client.testConnection(local)).toBe(false);
  });
});

describe("CloudAiClient.listModels", () => {
  it("parses OpenAI-compatible model ids and drops malformed entries", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "llama3.1" }, {}, { id: "" }, { id: "mistral" }] }),
    });
    const client = new CloudAiClient(new InMemoryCloudAiKeyStore(), fetchImpl as unknown as typeof fetch);
    const profile = createCloudProfile({ provider: "ollama" });
    await expect(client.listModels(profile)).resolves.toEqual(["llama3.1", "mistral"]);
  });

  it("throws on a non-OK response so callers can tell 'not running' apart from 'no models'", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const client = new CloudAiClient(new InMemoryCloudAiKeyStore(), fetchImpl as unknown as typeof fetch);
    const profile = createCloudProfile({ provider: "lmstudio" });
    await expect(client.listModels(profile)).rejects.toThrow(/404/);
  });

  it("throws when the fetch itself fails (server not running)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new CloudAiClient(new InMemoryCloudAiKeyStore(), fetchImpl as unknown as typeof fetch);
    const profile = createCloudProfile({ provider: "ollama" });
    await expect(client.listModels(profile)).rejects.toThrow();
  });
});
