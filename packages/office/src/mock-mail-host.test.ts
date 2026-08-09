import { describe, expect, it } from "vitest";
import { MockMailHost } from "./mock-mail-host.js";

describe("MockMailHost", () => {
  it("gets and sets body content", async () => {
    const host = new MockMailHost({ bodyText: "hello", mode: "compose" });

    await host.setBody({ html: "<p>updated</p>", text: "updated" });

    const message = await host.getCurrentMessage();
    expect(message.bodyHtml).toBe("<p>updated</p>");
    expect(message.bodyText).toBe("updated");
  });

  it("merges headers on setHeaders", async () => {
    const host = new MockMailHost({
      headers: { "X-Existing": "keep" },
      mode: "compose",
    });

    await host.setHeaders({ "X-SComm-Version": "1" });

    const headers = await host.getHeaders();
    expect(headers).toEqual({
      "X-Existing": "keep",
      "X-SComm-Version": "1",
    });
  });

  it("loads bodyHtml from testkit fixtures", async () => {
    const host = await MockMailHost.fromFixture("simple");
    const message = await host.getCurrentMessage();

    expect(message.bodyHtml).toContain("project update");
  });
});
