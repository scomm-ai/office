import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(rootDir, "..");
const sourceManifestPath = path.join(appDir, "manifest", "manifest.xml");
const distDir = path.join(appDir, "dist");
const outputManifestPath = path.join(distDir, "manifest.xml");
const committedHostedPath = path.join(appDir, "manifest", "manifest_correct.xml");
const baseUrl = process.env.SCOMM_OFFICE_BASE_URL ?? "https://office.scomm.ai";

const sourceManifest = await readFile(sourceManifestPath, "utf8");
const renderedManifest = sourceManifest
  .replace(/^\uFEFF/, "")
  .replaceAll("https://localhost:5173", baseUrl);

if (renderedManifest.includes("https://localhost:5173")) {
  throw new Error("Hosted manifest still contains https://localhost:5173");
}
if (!renderedManifest.includes(baseUrl)) {
  throw new Error(`Hosted manifest does not contain ${baseUrl}`);
}

await mkdir(distDir, { recursive: true });
await writeFile(outputManifestPath, renderedManifest, "utf8");
await writeFile(committedHostedPath, renderedManifest, "utf8");
await writeFile(path.join(distDir, ".nojekyll"), "");

process.stdout.write(`Rendered ${outputManifestPath} and ${committedHostedPath} for ${baseUrl}\n`);
