# Install the Scomm.AI Outlook add-in

## Hosted install (recommended)

Public manifest (HTTPS, `office.scomm.ai` URLs — not localhost):

**https://office.scomm.ai/manifest.xml**

Install page: **https://office.scomm.ai/**

GitHub fallback (same XML in the repo):

**https://raw.githubusercontent.com/scomm-ai/office/main/apps/outlook-addin/manifest/manifest_correct.xml**

If **Add from URL** rejects GitHub raw (`text/plain`), use the `office.scomm.ai` link or **Add from file** after downloading the XML.

### Outlook on the web / New Outlook

1. Open a mail item.
2. **Get Add-ins** (or **Settings → Manage add-ins**).
3. **My add-ins → Add a custom add-in → Add from URL**.
4. Paste `https://office.scomm.ai/manifest.xml` → **OK**.

### Classic Outlook (Windows)

Classic is the Win32 client (the **New Outlook** toggle is off). This is an Office.js add-in, not a COM add-in — it will not appear under File → Options → COM Add-ins.

1. Microsoft 365 / Exchange Online mailbox (POP/IMAP-only profiles usually cannot install).
2. **Home → Get Add-ins** (or **All Apps**). If that is missing: **File → Info → Manage Add-ins** (opens the web add-in manager).
3. **My add-ins → Custom add-ins → Add a custom add-in → Add from URL**.
4. Paste `https://office.scomm.ai/manifest.xml` → **OK**.
5. Quit Outlook completely (system tray too) and reopen.
6. Open a **mail** message. Ribbon group **Scomm.AI**: Decrypt / Verify on read; Encrypt / Sign on compose.

Admins can deploy the same URL in **Microsoft 365 admin center → Integrated apps**.

---

## Local development

Dev manifest: `apps/outlook-addin/manifest/manifest.xml` (points at **https://localhost:5173**).  
Do **not** share that file or URL for production installs.

### 1. Start the add-in dev server

```bash
pnpm --filter @scomm-office/outlook-addin dev
```

Visit **https://localhost:5173/taskpane.html** once and accept the self-signed certificate.

### 2. Trust HTTPS locally

Outlook loads the task pane over HTTPS. If the certificate is untrusted, the pane will be blank.

- **Browser:** proceed past the warning for `localhost:5173`
- **Classic Outlook:** WebView2 often ignores a browser click-through. Import the Vite cert into **Trusted Root Certification Authorities** (Current User), then restart Outlook.

### 3. Sideload the localhost manifest

**Outlook on the web / New Outlook / Classic:** **My add-ins → Add a custom add-in → Add from file** → `apps/outlook-addin/manifest/manifest.xml`.

Keep the Vite server running.

### 4. Open the task pane

1. Open a message (read or compose), not Calendar.
2. Ribbon: **Scomm.AI**
3. Task pane loads `https://localhost:5173/taskpane.html`

### 5. Event handlers

`commands.html` registers `onMessageSend` (block when directory OpenPGP keys exist and the body is unprotected), `onMessageCompose`, `encryptMessage`, and `signMessage`. LaunchEvents require Mailbox **1.12+**.

### 6. Troubleshooting

| Symptom | Check |
|---------|--------|
| Blank task pane | Dev server running? Cert trusted in WebView2? |
| Add-in not in ribbon | Sideloaded? Mail item (not calendar)? Restart Outlook |
| Add from URL fails | Use `https://office.scomm.ai/manifest.xml`, not localhost or GitHub HTML blob URLs |
| Pubkey errors | Production default is `https://pubkey.scomm.ai` |
| Icons 404 | PNGs under `apps/outlook-addin/public/assets/` |

### 7. Browser-only (no Outlook)

Open **https://localhost:5173/taskpane.html** — **MockMailHost** and a **Mock host** banner. Real encrypt/decrypt against a mailbox still needs Outlook + a sideloaded manifest.
