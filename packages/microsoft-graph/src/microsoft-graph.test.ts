import { describe, expect, it } from "vitest";
import { AuthenticationRequiredError, UnsupportedFeatureError } from "@scomm-office/core";
import {
  createFixtureConversation,
  MockMicrosoftGraph,
} from "./mock-graph.js";
import {
  UnsupportedMicrosoftGraphClient,
  UnsupportedMicrosoftIdentityProvider,
} from "./unsupported.js";

describe("UnsupportedMicrosoftGraphClient", () => {
  it("throws UnsupportedFeatureError", async () => {
    const client = new UnsupportedMicrosoftGraphClient();
    await expect(client.getCurrentUser()).rejects.toThrow(UnsupportedFeatureError);
    await expect(client.getMessageById("x")).rejects.toThrow(/002-office-graph-boundary/);
  });
});

describe("UnsupportedMicrosoftIdentityProvider", () => {
  it("throws AuthenticationRequiredError", async () => {
    const provider = new UnsupportedMicrosoftIdentityProvider();
    await expect(provider.getUser()).rejects.toThrow(AuthenticationRequiredError);
    await expect(provider.getGraphToken(["Mail.Read"])).rejects.toThrow(/graph-authentication/);
  });
});

describe("MockMicrosoftGraph", () => {
  it("returns fixture-like conversation and search results", async () => {
    const graph = new MockMicrosoftGraph();
    for (const message of createFixtureConversation()) {
      graph.addMessage(message);
    }

    const thread = await graph.getConversationMessages("conv-001");
    expect(thread).toHaveLength(2);

    const search = await graph.searchMessages("latest status");
    expect(search).toHaveLength(1);
    expect(search[0]?.id).toBe("msg-001");

    const user = await graph.getCurrentUser();
    expect(user.mail).toBe("alice@example.com");

    const contacts = await graph.getContacts({ search: "bob" });
    expect(contacts[0]?.emailAddresses[0]?.address).toBe("bob@partner.org");
  });
});
