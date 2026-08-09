import { describe, expect, it } from "vitest";
import { detectOutlookCapabilities } from "./capabilities.js";

describe("detectOutlookCapabilities", () => {
  it("returns all Office flags false without Office global", () => {
    const caps = detectOutlookCapabilities(undefined);

    expect(caps.mailboxRequirementSet).toBe("0");
    expect(caps.internetHeaders).toBe(false);
    expect(caps.eventBasedActivation).toBe(false);
    expect(caps.onMessageCompose).toBe(false);
    expect(caps.onMessageSend).toBe(false);
    expect(caps.smartAlerts).toBe(false);
    expect(caps.onMessageDecrypt).toBe(false);
    expect(caps.attachments).toBe(false);
    expect(caps.signatureApi).toBe(false);
    expect(caps.nestedAppAuthentication).toBe(false);
    expect(typeof caps.webRtc).toBe("boolean");
    expect(typeof caps.webCryptoEd25519).toBe("boolean");
  });

  it("detects requirement sets from mock Office context", () => {
    const caps = detectOutlookCapabilities({
      Office: {
        context: {
          requirements: {
            isSetSupported: (set: string, version: string) =>
              set === "Mailbox" && (version === "1.8" || version === "1.12" || version === "1.1"),
          },
        },
      },
    });

    expect(caps.mailboxRequirementSet).toBe("1.12");
    expect(caps.internetHeaders).toBe(true);
    expect(caps.onMessageSend).toBe(true);
    expect(caps.onMessageCompose).toBe(true);
    expect(caps.nestedAppAuthentication).toBe(false);
  });
});
