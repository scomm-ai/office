import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const packagesDir = path.resolve(rootDir, "../../packages");

const workspacePackages = [
  "core",
  "office",
  "semantics",
  "protocol",
  "policy",
  "testkit",
  "identity",
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
  plugins: [react()],
  resolve: {
    alias: workspaceAliases(),
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
