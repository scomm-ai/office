import { describe, expect, it } from "vitest";
import {
  applyEnvHostUpdates,
  DEFAULT_SETTINGS,
  formatAddresses,
  isLoopbackHostname,
  resolvePubkeyReadBaseUrl,
  resolvePubkeyWriteBaseUrl,
} from "./settings";

describe("formatAddresses", () => {
  it("returns em dash when empty", () => {
    expect(formatAddresses(undefined)).toBe("—");
  });

  it("formats display names", () => {
    expect(formatAddresses([{ emailAddress: "a@b.com", displayName: "A" }])).toBe("A <a@b.com>");
  });
});

describe("resolvePubkeyWriteBaseUrl", () => {
  it("uses the sticky same-origin proxy on localhost", () => {
    expect(
      resolvePubkeyWriteBaseUrl(
        { ...DEFAULT_SETTINGS, pubkeyWriteBaseUrl: "https://pubkey.scomm.ai" },
        { hostname: "localhost", origin: "https://localhost:5175" },
      ),
    ).toBe("https://localhost:5175/pubkey-write");
  });

  it("uses the sticky same-origin proxy on IPv6 loopback", () => {
    expect(
      resolvePubkeyWriteBaseUrl(
        { ...DEFAULT_SETTINGS, pubkeyWriteBaseUrl: "https://pubkey.scomm.ai" },
        { hostname: "[::1]", origin: "https://[::1]:5175" },
      ),
    ).toBe("https://[::1]:5175/pubkey-write");
  });

  it("defaults to production pubkey off loopback when write URL is unset", () => {
    expect(
      resolvePubkeyWriteBaseUrl(
        { ...DEFAULT_SETTINGS, pubkeyWriteBaseUrl: undefined },
        { hostname: "addin.scomm.ai", origin: "https://addin.scomm.ai" },
      ),
    ).toBe("https://pubkey.scomm.ai");
  });

  it("rewrites the non-resolving api.pubkey host to production", () => {
    expect(
      resolvePubkeyWriteBaseUrl(
        { ...DEFAULT_SETTINGS, pubkeyWriteBaseUrl: "https://api.pubkey.scomm.ai" },
        { hostname: "addin.scomm.ai", origin: "https://addin.scomm.ai" },
      ),
    ).toBe("https://pubkey.scomm.ai");
  });

  it("keeps a custom write host off loopback", () => {
    expect(
      resolvePubkeyWriteBaseUrl(
        { ...DEFAULT_SETTINGS, pubkeyWriteBaseUrl: "https://write.example.com" },
        { hostname: "addin.scomm.ai", origin: "https://addin.scomm.ai" },
      ),
    ).toBe("https://write.example.com");
  });
});

describe("resolvePubkeyReadBaseUrl", () => {
  it("uses the same-origin proxy on localhost", () => {
    expect(
      resolvePubkeyReadBaseUrl(
        { ...DEFAULT_SETTINGS, pubkeyReadBaseUrl: "http://localhost:3030" },
        { hostname: "localhost", origin: "https://localhost:5175" },
      ),
    ).toBe("https://localhost:5175/pubkey-read");
  });

  it("uses the configured host off loopback", () => {
    expect(
      resolvePubkeyReadBaseUrl(
        { ...DEFAULT_SETTINGS, pubkeyReadBaseUrl: "http://localhost:3030" },
        { hostname: "addin.scomm.ai", origin: "https://addin.scomm.ai" },
      ),
    ).toBe("http://localhost:3030");
  });
});

describe("applyEnvHostUpdates", () => {
  it("replaces stale stored pubkey URLs when env snapshot is missing", () => {
    const { settings } = applyEnvHostUpdates(
      { ...DEFAULT_SETTINGS, pubkeyReadBaseUrl: "https://pubkey.scomm.ai" },
      { ...DEFAULT_SETTINGS, pubkeyReadBaseUrl: "http://localhost:3030" },
      null,
    );
    expect(settings.pubkeyReadBaseUrl).toBe("http://localhost:3030");
  });

  it("replaces a pubkey URL only when that env value changed", () => {
    const env = {
      ...DEFAULT_SETTINGS,
      pubkeyReadBaseUrl: "http://localhost:3030",
      billingOrigin: "http://localhost:3000",
    };
    const { settings } = applyEnvHostUpdates(
      { ...env, pubkeyReadBaseUrl: "https://pubkey.scomm.ai", billingOrigin: "https://billing.example" },
      env,
      {
        pubkeyReadBaseUrl: "https://pubkey.scomm.ai",
        pubkeyWriteBaseUrl: env.pubkeyWriteBaseUrl ?? "",
        pubkeyServerUrl: env.pubkeyServerUrl ?? "",
        scommServerUrl: env.scommServerUrl ?? "",
        billingOrigin: "http://localhost:3000",
        billingPortalUrl: env.billingPortalUrl ?? "",
      },
    );
    expect(settings.pubkeyReadBaseUrl).toBe("http://localhost:3030");
    expect(settings.billingOrigin).toBe("https://billing.example");
  });
});

describe("isLoopbackHostname", () => {
  it("accepts localhost and loopback addresses", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("addin.scomm.ai")).toBe(false);
  });
});
