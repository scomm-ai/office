import { expect, test, type Page } from "@playwright/test";
import type { MailMessage } from "@scomm-office/office";

/**
 * Auto-decrypt/auto-verify on message open (SecurityPanel.tsx). These run
 * against the mock host (no real Office, no pubkey-server) via a dev-only
 * seam — window.__SCOMM_MOCK_MESSAGE__, read once in App.tsx's bootstrapHost
 * behind import.meta.env.DEV — so they cover the trigger logic (header +
 * body-armor detection, locked-vs-unlocked branching, once-per-item guard)
 * but NOT a real successful decrypt, since that needs a real OpenPGP private
 * key in an unlocked Vault, which this environment has no way to produce
 * without either a running local pubkey-server (apps/server, OTP enrollment)
 * or a dedicated dev-only key-seeding hook.
 */

const ENCRYPTED_BODY = [
  "-----BEGIN PGP MESSAGE-----",
  "Version: OpenPGP.js",
  "",
  "wV4DsomeFakeSessionKeyDataThatIsNotRealCiphertext1234567890",
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456",
  "-----END PGP MESSAGE-----",
].join("\n");

const SIGNED_BODY = [
  "-----BEGIN PGP SIGNED MESSAGE-----",
  "Hash: SHA256",
  "",
  "Hello, this is a signed test message.",
  "-----BEGIN PGP SIGNATURE-----",
  "Version: OpenPGP.js",
  "",
  "wsBcBAEBCAAQBQJmFakeSignatureDataHereForTest==",
  "=AbCd",
  "-----END PGP SIGNATURE-----",
].join("\n");

async function gotoSecurityWithMockMessage(page: Page, message: Partial<MailMessage>) {
  await page.addInitScript((msg) => {
    (window as unknown as { __SCOMM_MOCK_MESSAGE__?: unknown }).__SCOMM_MOCK_MESSAGE__ = msg;
  }, message);
  await page.goto("/taskpane.html?module=security");
  await expect(page.getByText(/OpenPGP \(read\)/i)).toBeVisible({ timeout: 30_000 });
}

test.describe("SecurityPanel auto-decrypt on open (mock host)", () => {
  test("encrypted message, locked vault: shows unlock note, never a passphrase prompt", async ({
    page,
  }) => {
    await gotoSecurityWithMockMessage(page, {
      id: "msg-encrypted-1",
      mode: "read",
      subject: "Encrypted test",
      bodyText: ENCRYPTED_BODY,
    });

    await expect(page.getByText(/Current item looks like OpenPGP/i)).toBeVisible();
    await expect(
      page.getByText(/unlock your Vault.*to auto-decrypt/i),
    ).toBeVisible({ timeout: 10_000 });

    // Auto-decrypt must never itself prompt for a passphrase/OTP — but the
    // page's separate "Vault backup" section always has its own passphrase
    // field regardless of this feature, so scope the check to identity
    // bootstrap state instead of a page-wide text search.
    await expect(page.getByPlaceholder(/11-character code/i)).toHaveCount(0);

    // No plaintext was produced (nothing to decrypt with — locked).
    await expect(page.locator("pre")).toHaveCount(0);
  });

  test("signed-only message: auto-verify runs without a click", async ({ page }) => {
    await gotoSecurityWithMockMessage(page, {
      id: "msg-signed-1",
      mode: "read",
      subject: "Signed test",
      bodyText: SIGNED_BODY,
    });

    await expect(page.getByText(/Current item looks like OpenPGP/i)).toBeVisible();
    // No session/network in this environment, so verify fails — but a
    // status line appearing at all (without clicking "Verify signature")
    // is proof the auto-verify path fired, not the decrypt path.
    await expect(page.getByText(/Verify failed/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/unlock your Vault.*to auto-decrypt/i)).toHaveCount(0);
  });

  test("plain message: no OpenPGP note, no auto action", async ({ page }) => {
    await gotoSecurityWithMockMessage(page, {
      id: "msg-plain-1",
      mode: "read",
      subject: "Plain test",
      bodyText: "Just a normal email, nothing encrypted here.",
    });

    await expect(page.getByText(/OpenPGP \(read\)/i)).toBeVisible();
    await expect(page.getByText(/Current item looks like OpenPGP/i)).toHaveCount(0);
    await expect(page.getByText(/unlock your Vault.*to auto-decrypt/i)).toHaveCount(0);
    await expect(page.locator("pre")).toHaveCount(0);
  });

  test("fires only once per item: no duplicate verify status flicker", async ({ page }) => {
    await gotoSecurityWithMockMessage(page, {
      id: "msg-signed-2",
      mode: "read",
      subject: "Signed test 2",
      bodyText: SIGNED_BODY,
    });

    const status = page.getByText(/Verify failed/i);
    await expect(status).toBeVisible({ timeout: 10_000 });
    const firstText = await status.textContent();

    // Give any spurious re-render/re-fire a moment, then confirm the status
    // line didn't change again (a second auto-verify would still likely
    // produce the same text, but a click-count/log-based signal isn't
    // available from the browser side — this is a best-effort stability
    // check, not a substitute for the ref-guard code review).
    await page.waitForTimeout(1000);
    await expect(status).toHaveText(firstText ?? "");
  });
});
