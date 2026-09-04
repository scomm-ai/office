# Install the Scomm.AI Outlook add-in

## Hosted install (recommended)

Microsoft **disabled Add from URL** for custom Outlook add-ins (security). That control stays dimmed. Install from a **file**.

1. Download **[scomm-ai-outlook.xml](https://office.scomm.ai/manifest.xml)** (or open that URL and **Save As** `.xml`).
2. In a browser go to **[https://aka.ms/olksideload](https://aka.ms/olksideload)** (Outlook on the web add-in dialog). Classic Outlook: **File → Info → Manage Add-ins**.
3. **My add-ins** → **Custom add-ins** → **Add a custom add-in** → **Add from File** → the XML → **Install**.
4. Restart Outlook. Open a **mail** item. Ribbon group **Scomm.AI**: Decrypt / Verify on read; Encrypt / Sign on compose.

Install page: **https://office.scomm.ai/**

The hosted XML (for download or admin Centralized Deployment) is **https://office.scomm.ai/manifest.xml**. Repo copy: `apps/outlook-addin/manifest/manifest_correct.xml`.

Classic Outlook can take up to ~24 hours to show a sideloaded add-in because of client cache; a full quit (tray icon too) often helps sooner.

### Classic Outlook (Windows)

Classic is the Win32 client (**New Outlook** toggle off). This is an Office.js add-in, not COM — it will not appear under File → Options → COM Add-ins.

Use **Add from File** as above. Microsoft 365 / Exchange Online mailbox required (POP/IMAP-only profiles usually cannot install).

Admins can deploy the XML in **Microsoft 365 admin center → Integrated apps** (that path can still use a hosted URL even though user sideload cannot).

---

## Local development

Committed template: `apps/outlook-addin/manifest/manifest.xml` (default **https://localhost:5173**).  
After `pnpm dev`, sideload **`manifest.local.xml`** — it is rewritten from `ADDIN_PORT` in the repo-root `.env` (default `5173`).  
Do **not** share those files or URLs for production installs.

### 1. Start the add-in dev server

```bash
pnpm --filter @scomm-office/outlook-addin dev
```

If 5173 is taken (for example the billing portal), set `ADDIN_PORT=5175` in `.env`. Visit `https://localhost:<ADDIN_PORT>/taskpane.html` once and accept the self-signed certificate.

### 2. Trust HTTPS locally

Outlook loads the task pane over HTTPS. If the certificate is untrusted, the pane will be blank.

- **Browser:** proceed past the warning for `localhost:<ADDIN_PORT>`
- **Classic Outlook:** WebView2 often ignores a browser click-through. Import the Vite cert into **Trusted Root Certification Authorities** (Current User), then restart Outlook.

### 3. Sideload the localhost manifest

**Outlook on the web / New Outlook / Classic:** **My add-ins → Add a custom add-in → Add from file** → `apps/outlook-addin/manifest/manifest.local.xml` (generated when the Vite server starts). Re-install that file whenever `ADDIN_PORT` changes.

Keep the Vite server running.

### 4. Open the task pane

1. Open a message (read or compose), not Calendar.
2. Ribbon: **Scomm.AI**
3. Task pane loads `https://localhost:<ADDIN_PORT>/taskpane.html`

### 5. Event handlers

`commands.html` registers `onMessageSend` (block when directory OpenPGP keys exist and the body is unprotected), `onMessageCompose`, `encryptMessage`, and `signMessage`. LaunchEvents require Mailbox **1.12+**.

### 6. Troubleshooting

| Symptom | Check |
|---------|--------|
| Blank task pane | Dev server running? Cert trusted in WebView2? |
| “Add-in may not load properly” | Sideloaded `manifest.local.xml` (not the 5173 template)? `ADDIN_PORT` matches the running Vite server? |
| Add-in not in ribbon | Sideloaded? Mail item (not calendar)? Restart Outlook |
| Add from URL dimmed | Microsoft removed that option. Download the XML and **Add from File** |
| Pubkey errors | Production default is `https://pubkey.scomm.ai` |
| Icons 404 | PNGs under `apps/outlook-addin/public/assets/` |

### 7. Browser-only (no Outlook)

Open `https://localhost:<ADDIN_PORT>/taskpane.html` (default 5173) — **MockMailHost** and a **Mock host** banner. Real encrypt/decrypt against a mailbox still needs Outlook + a sideloaded manifest.
