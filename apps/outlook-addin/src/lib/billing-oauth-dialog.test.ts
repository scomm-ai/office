import { describe, expect, it } from "vitest";
import {
  HTTP_BILLING_SIGNIN_MESSAGE,
  officeDialogErrorMessage,
  officeHandoffPollUrl,
  officeHostedDialogStartUrl,
  officeHostedPopupStartUrl,
  resolveOAuthOpenMode,
} from "./billing-oauth-dialog";

describe("officeDialogErrorMessage", () => {
  it("explains AppDomain blocks", () => {
    expect(officeDialogErrorMessage(12002)).toMatch(/AppDomains/);
  });

  it("treats 12006 as a closed window", () => {
    expect(officeDialogErrorMessage(12006)).toMatch(/closed/);
  });

  it("maps 12005 to the HTTPS requirement", () => {
    expect(officeDialogErrorMessage(12005)).toBe(HTTP_BILLING_SIGNIN_MESSAGE);
  });
});

describe("resolveOAuthOpenMode", () => {
  it("uses an Office dialog whenever displayDialogAsync exists", () => {
    expect(
      resolveOAuthOpenMode("https://billing.scomm.ai/oauth/office-start.html", true),
    ).toBe("office-dialog");
    expect(resolveOAuthOpenMode("http://localhost:3000/oauth/office-start.html", true)).toBe(
      "office-dialog",
    );
  });

  it("falls back to a popup when Office dialog is missing", () => {
    expect(
      resolveOAuthOpenMode("https://billing.scomm.ai/oauth/office-start.html", false),
    ).toBe("browser-popup");
  });
});

describe("officeHostedDialogStartUrl", () => {
  it("opens the add-in HTTPS start page with the billing URL as a query", () => {
    const url = officeHostedDialogStartUrl(
      "https://billing.scomm.ai/oauth/office-start.html?provider=google",
      "https://localhost:5173",
    );
    expect(url.startsWith("https://localhost:5173/auth-start.html?")).toBe(true);
    expect(new URL(url).searchParams.get("start")).toContain("office-start.html");
  });
});

describe("officeHandoffPollUrl", () => {
  it("polls billing directly when billing is HTTPS", () => {
    expect(
      officeHandoffPollUrl(
        "https://billing.scomm.ai",
        "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        "https://localhost:5175",
      ),
    ).toBe("https://billing.scomm.ai/oauth/office-handoff/7c9e6679-7425-40de-944b-e07fc1f90ae7");
  });

  it("uses the add-in HTTPS proxy when billing is HTTP", () => {
    expect(
      officeHandoffPollUrl(
        "http://localhost:3000",
        "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        "https://localhost:5175",
      ),
    ).toBe("https://localhost:5175/oauth-office-handoff/7c9e6679-7425-40de-944b-e07fc1f90ae7");
  });
});

describe("officeHostedPopupStartUrl", () => {
  it("opens the add-in start page with mode=popup so HTTP billing can redirect", () => {
    const url = officeHostedPopupStartUrl(
      "http://localhost:3000/oauth/office-start.html?provider=google",
      "https://localhost:5175",
    );
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://localhost:5175");
    expect(parsed.pathname).toBe("/auth-start.html");
    expect(parsed.searchParams.get("mode")).toBe("popup");
    expect(parsed.searchParams.get("start")).toContain("http://localhost:3000/oauth/office-start.html");
  });
});
