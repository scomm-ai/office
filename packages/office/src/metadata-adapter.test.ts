import { describe, expect, it } from "vitest";
import { X_SCOMM_MESSAGE_UID, X_SCOMM_VERSION } from "@scomm-office/protocol";
import { MockMailHost } from "./mock-mail-host.js";
import { ScommMessageMetadataAdapter } from "./metadata-adapter.js";

describe("ScommMessageMetadataAdapter", () => {
  it("roundtrips metadata through MailHost headers", async () => {
    const host = new MockMailHost({ mode: "compose", headers: {} });
    const adapter = new ScommMessageMetadataAdapter(host);

    await adapter.write({
      version: "1",
      messageUid: "scomm_msg_abc123",
      schema: "semantics/1.0",
      semanticDigest: "deadbeef",
    });

    const metadata = await adapter.read();
    expect(metadata).toEqual({
      version: "1",
      messageUid: "scomm_msg_abc123",
      schema: "semantics/1.0",
      semanticDigest: "deadbeef",
    });

    const headers = await host.getHeaders();
    expect(headers[X_SCOMM_VERSION]).toBe("1");
    expect(headers[X_SCOMM_MESSAGE_UID]).toBe("scomm_msg_abc123");
  });
});
