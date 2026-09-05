import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MicrosoftGraphError } from "@scomm-office/core";
import { HttpMicrosoftGraphClient, type GraphTokenProvider } from "./http-graph-client.js";

function tokenProvider(token = "test-token"): GraphTokenProvider {
  return { getGraphToken: vi.fn().mockResolvedValue(token) };
}

describe("HttpMicrosoftGraphClient.sendMimeMessage", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("creates a draft from raw MIME then sends it", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "draft-1" }), { status: 201 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }));

    const client = new HttpMicrosoftGraphClient(tokenProvider());
    await client.sendMimeMessage(new TextEncoder().encode("Subject: hi\r\n\r\nbody"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [createUrl, createInit] = fetchMock.mock.calls[0]!;
    expect(createUrl).toBe("https://graph.microsoft.com/v1.0/me/messages");
    expect(createInit.method).toBe("POST");
    expect(createInit.headers["Content-Type"]).toBe("text/plain");
    // Graph's create-from-MIME endpoint requires base64, not raw text —
    // sending raw bytes fails with ErrorMimeContentInvalidBase64String.
    expect(createInit.body).toBe(btoa("Subject: hi\r\n\r\nbody"));

    const [sendUrl, sendInit] = fetchMock.mock.calls[1]!;
    expect(sendUrl).toBe("https://graph.microsoft.com/v1.0/me/messages/draft-1/send");
    expect(sendInit.method).toBe("POST");
  });

  it("throws MicrosoftGraphError when draft creation fails", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(new Response("bad request", { status: 400 }));

    const client = new HttpMicrosoftGraphClient(tokenProvider());
    await expect(
      client.sendMimeMessage(new TextEncoder().encode("Subject: hi\r\n\r\nbody")),
    ).rejects.toThrow(MicrosoftGraphError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws MicrosoftGraphError when send fails after a successful draft", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "draft-1" }), { status: 201 }))
      .mockResolvedValueOnce(new Response("server error", { status: 500 }));

    const client = new HttpMicrosoftGraphClient(tokenProvider());
    await expect(
      client.sendMimeMessage(new TextEncoder().encode("Subject: hi\r\n\r\nbody")),
    ).rejects.toThrow(MicrosoftGraphError);
  });
});
