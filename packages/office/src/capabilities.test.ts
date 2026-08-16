import { describe, expect, it } from "vitest";
import { detectOutlookCapabilities, attachmentEncryptionNotice } from "./capabilities.js";
import type { OutlookCapabilities } from "./capabilities.js";

function caps(overrides: Partial<OutlookCapabilities>): OutlookCapabilities {
  return {
    mailboxRequirementSet: "0",
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
    ...overrides,
  };
}

describe("detectOutlookCapabilities", () => {
  it("returns all Office flags false without Office global", () => {
    const detected = detectOutlookCapabilities(undefined);

    expect(detected.mailboxRequirementSet).toBe("0");
    expect(detected.internetHeaders).toBe(false);
    expect(detected.eventBasedActivation).toBe(false);
    expect(detected.onMessageCompose).toBe(false);
    expect(detected.onMessageSend).toBe(false);
    expect(detected.smartAlerts).toBe(false);
    expect(detected.onMessageDecrypt).toBe(false);
    expect(detected.attachments).toBe(false);
    expect(detected.signatureApi).toBe(false);
    expect(detected.nestedAppAuthentication).toBe(false);
    expect(typeof detected.webRtc).toBe("boolean");
    expect(typeof detected.webCryptoEd25519).toBe("boolean");
  });

  it("detects requirement sets from mock Office context", () => {
    const detected = detectOutlookCapabilities({
      Office: {
        context: {
          requirements: {
            isSetSupported: (set: string, version: string) => {
              if (set !== "Mailbox") return false;
              const [major, minor] = version.split(".").map(Number);
              if (major !== 1 || minor === undefined) return false;
              return minor <= 12;
            },
          },
        },
      },
    });

    expect(detected.mailboxRequirementSet).toBe("1.12");
    expect(detected.internetHeaders).toBe(true);
    expect(detected.attachments).toBe(true);
    expect(detected.onMessageSend).toBe(true);
    expect(detected.onMessageCompose).toBe(true);
    expect(detected.nestedAppAuthentication).toBe(false);
  });

  it("detects Mailbox 1.3 without later optional sets", () => {
    const detected = detectOutlookCapabilities({
      Office: {
        context: {
          requirements: {
            isSetSupported: (set: string, version: string) =>
              set === "Mailbox" && ["1.1", "1.2", "1.3"].includes(version),
          },
        },
      },
    });

    expect(detected.mailboxRequirementSet).toBe("1.3");
    expect(detected.internetHeaders).toBe(false);
    expect(detected.attachments).toBe(false);
    expect(detected.onMessageCompose).toBe(false);
    expect(detected.onMessageSend).toBe(false);
  });

  it("describes attachment encrypt limits below Mailbox 1.8", () => {
    const notice = attachmentEncryptionNotice(caps({ mailboxRequirementSet: "1.3" }));

    expect(notice).toContain("Mailbox 1.3");
    expect(notice).toContain("Attachments are not encrypted");
    expect(attachmentEncryptionNotice(caps({ mailboxRequirementSet: "1.12", attachments: true }))).toBeNull();
  });
});
