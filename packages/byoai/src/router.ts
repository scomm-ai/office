import type { IdrTransport } from "@scomm-office/idr";
import { OllamaViaIdrProvider } from "@scomm-office/idr";
import type { CloudAiClient } from "./cloud-client.js";
import {
  BILLING_ADDON_AI_ASSISTANT,
  hasAiEntitlement,
  type AddonGate,
  type AiEntitlementPolicy,
} from "./entitlements.js";
import type { ByoaiSettings, CloudAiProfile } from "./types.js";

export type { AddonGate, AiEntitlementPolicy } from "./entitlements.js";
export { BILLING_ADDON_AI_ASSISTANT, hasAiEntitlement } from "./entitlements.js";

export class ByoaiRouter {
  constructor(
    private readonly settings: ByoaiSettings,
    private readonly cloudClient: CloudAiClient,
    private readonly getIdrTransport: () => IdrTransport | null,
    private readonly getAddonGate: () => AddonGate | null,
    private readonly policy: AiEntitlementPolicy = { requireAiAddon: true },
  ) {}

  assertEntitled(): void {
    if (!hasAiEntitlement(this.getAddonGate(), this.policy)) {
      throw new Error(
        `AI features require the "${BILLING_ADDON_AI_ASSISTANT}" add-on. Sync billing or paste a license token.`,
      );
    }
  }

  defaultCloudProfile(): CloudAiProfile | null {
    return (
      this.settings.cloudProfiles.find((p) => p.isDefault) ??
      this.settings.cloudProfiles[0] ??
      null
    );
  }

  async summarize(text: string): Promise<string> {
    this.assertEntitled();
    const route = this.settings.preferredRoute;
    if (route === "cloud" || (route !== "local" && this.defaultCloudProfile())) {
      const profile = this.defaultCloudProfile();
      if (!profile) {
        throw new Error("No cloud AI profile configured.");
      }
      const result = await this.cloudClient.chat({
        profile,
        messages: [
          {
            role: "system",
            content:
              "You summarize email text for a security-conscious mail client. Return plain text only. Do not invent actions or tool calls.",
          },
          { role: "user", content: text.slice(0, 12_000) },
        ],
      });
      return result.content;
    }

    const transport = this.getIdrTransport();
    if (!transport) {
      throw new Error("IDR transport is not connected for local AI.");
    }
    const provider = new OllamaViaIdrProvider(transport);
    const model = this.settings.local.defaultModel;
    if (!model) {
      throw new Error("Local AI default model is not set.");
    }
    const response = await provider.generate({
      model,
      prompt: `Summarize this email for the user (plain text only):\n\n${text.slice(0, 12_000)}`,
      stream: false,
    });
    return response.response;
  }
}
