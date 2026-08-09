import { describe, expect, it } from "vitest";
import { jsonResponse, MockIdrTransport } from "./mock-transport.js";
import { OllamaViaIdrProvider } from "./ollama-provider.js";

describe("OllamaViaIdrProvider", () => {
  it("lists models from /api/tags via MockIdrTransport", async () => {
    const transport = new MockIdrTransport();
    transport.setFetchHandler(async (request) => {
      expect(request.path).toBe("/api/tags");
      expect(request.method).toBe("GET");
      return jsonResponse({
        models: [{ name: "llama3.2:latest" }, { name: "mistral:latest" }],
      });
    });

    const provider = new OllamaViaIdrProvider(transport);
    const models = await provider.listModels();

    expect(models).toEqual(["llama3.2:latest", "mistral:latest"]);
  });
});

describe("MockIdrTransport", () => {
  it("tracks authentication state", async () => {
    const transport = new MockIdrTransport();
    expect(transport.isAuthenticated()).toBe(false);
    await transport.authenticate({ interactive: false });
    expect(transport.isAuthenticated()).toBe(true);
  });
});
