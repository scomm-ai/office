import { describe, expect, it } from "vitest";
import { resolveEffectiveConfiguration } from "./resolve.js";

describe("resolveEffectiveConfiguration", () => {
  const userDefaults = {
    scommServerUrl: "https://user-scomm.example.com",
    pubkeyServerUrl: "https://user-pubkey.example.com",
    idrTargetHost: "user-box.idr",
    idrDefaultService: "ollama",
    semanticAnalysisEnabled: true,
    complianceEnabled: false,
    experimentalEncryptionEnabled: false,
    diagnosticsEnabled: true,
  };

  it("returns user settings when no organization config is provided", () => {
    const result = resolveEffectiveConfiguration(userDefaults);
    expect(result.effective).toEqual(userDefaults);
    expect(result.organization).toBeUndefined();
  });

  it("uses organization defaults for unset user fields", () => {
    const result = resolveEffectiveConfiguration(
      { semanticAnalysisEnabled: true },
      {
        scommServerUrl: "https://org-scomm.example.com",
        complianceEnabled: true,
      },
    );
    expect(result.effective.scommServerUrl).toBe("https://org-scomm.example.com");
    expect(result.effective.complianceEnabled).toBe(true);
    expect(result.effective.semanticAnalysisEnabled).toBe(true);
  });

  it("overrides user values for enforced organization fields", () => {
    const result = resolveEffectiveConfiguration(userDefaults, {
      scommServerUrl: "https://org-scomm.example.com",
      complianceEnabled: true,
      experimentalEncryptionEnabled: false,
      enforcedFields: ["scommServerUrl", "complianceEnabled", "experimentalEncryptionEnabled"],
    });
    expect(result.effective.scommServerUrl).toBe("https://org-scomm.example.com");
    expect(result.effective.complianceEnabled).toBe(true);
    expect(result.effective.experimentalEncryptionEnabled).toBe(false);
    expect(result.effective.pubkeyServerUrl).toBe(userDefaults.pubkeyServerUrl);
  });

  it("does not override user values for non-enforced organization fields", () => {
    const result = resolveEffectiveConfiguration(userDefaults, {
      pubkeyServerUrl: "https://org-pubkey.example.com",
      idrTargetHost: "org-box.idr",
    });
    expect(result.effective.pubkeyServerUrl).toBe(userDefaults.pubkeyServerUrl);
    expect(result.effective.idrTargetHost).toBe(userDefaults.idrTargetHost);
  });
});
