import { describe, expect, it } from "vitest";
import { OutlookMailHost } from "./outlook-mail-host.js";
import type { OutlookCapabilities } from "./capabilities.js";

const mailbox13: OutlookCapabilities = {
  mailboxRequirementSet: "1.3",
  internetHeaders: false,
  eventBasedActivation: false,
  onMessageCompose: false,
  onMessageSend: false,
  smartAlerts: false,
  onMessageDecrypt: false,
  attachments: false,
  signatureApi: false,
  nestedAppAuthentication: false,
  webRtc: false,
  webCryptoEd25519: false,
};

function asyncOk<T>(value: T) {
  return (callback: (result: { status: string; value: T }) => void) => {
    callback({ status: "succeeded", value });
  };
}

describe("OutlookMailHost", () => {
  it("returns body on Mailbox 1.3 compose when attachments API is missing", async () => {
    const office = {
      context: {
        mailbox: {
          item: {
            itemType: "messageCompose",
            subject: { getAsync: asyncOk("Hello") },
            to: { getAsync: asyncOk([{ emailAddress: "a@example.com", displayName: "A" }]) },
            cc: { getAsync: asyncOk([]) },
            bcc: { getAsync: asyncOk([]) },
            body: {
              getAsync: (coercionType: string, callback: (result: { status: string; value: string }) => void) => {
                callback({
                  status: "succeeded",
                  value: coercionType === "html" ? "<p>secret</p>" : "secret",
                });
              },
              setAsync: (
                _data: string,
                _options: { coercionType: string },
                callback: (result: { status: string }) => void,
              ) => {
                callback({ status: "succeeded" });
              },
            },
          },
        },
      },
    };

    const host = new OutlookMailHost(office, mailbox13);
    const message = await host.getCurrentMessage();

    expect(message.mode).toBe("compose");
    expect(message.bodyText).toBe("secret");
    expect(message.bodyHtml).toBe("<p>secret</p>");
    expect(message.attachments).toEqual([]);
    expect(message.to?.[0]?.emailAddress).toBe("a@example.com");
  });

  it("maps read-mode attachments array without getAsync", async () => {
    const office = {
      context: {
        mailbox: {
          item: {
            itemType: "message",
            subject: "Re: Hello",
            from: { emailAddress: "a@example.com", displayName: "A" },
            to: [{ emailAddress: "b@example.com", displayName: "B" }],
            body: {
              getAsync: (_coercionType: string, callback: (result: { status: string; value: string }) => void) => {
                callback({ status: "succeeded", value: "hi" });
              },
            },
            attachments: [
              { id: "att-1", name: "file.pdf", contentType: "application/pdf", size: 12, isInline: false },
            ],
          },
        },
      },
    };

    const host = new OutlookMailHost(office, mailbox13);
    const message = await host.getCurrentMessage();

    expect(message.mode).toBe("read");
    expect(message.attachments).toEqual([
      { id: "att-1", name: "file.pdf", contentType: "application/pdf", size: 12, isInline: false },
    ]);
  });
});
