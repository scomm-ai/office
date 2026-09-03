import path from "node:path";
import { fileURLToPath } from "node:url";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(rootDir, "../../packages");

const workspacePackages = [
  "core",
  "office",
  "semantics",
  "protocol",
  "pubkeys",
  "identity",
  "idr",
  "policy",
  "config",
  "storage",
  "byoai",
  "observability",
  "microsoft-graph",
  "crypto",
  "message-core",
  "mime",
  "crypto-openpgp",
  "crypto-smime",
  "semantic-signatures",
  "capability-negotiation",
  "mail-security",
] as const;

function workspaceAliases(): Record<string, string> {
  const aliases = Object.fromEntries(
    workspacePackages.map((name) => [
      `@scomm-office/${name}`,
      path.join(packagesDir, name, "src", "index.ts"),
    ]),
  );
  aliases["@scomm-office/testkit"] = path.resolve(rootDir, "src/stubs/testkit-browser.ts");
  aliases["node:crypto"] = path.resolve(rootDir, "src/stubs/node-crypto.ts");
  return aliases;
}

export default defineConfig({
  plugins: [react(), basicSsl()],
  resolve: {
    alias: workspaceAliases(),
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        taskpane: path.resolve(rootDir, "taskpane.html"),
        commands: path.resolve(rootDir, "commands.html"),
      },
    },
  },
});
