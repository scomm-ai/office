import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(rootDir, "..");
const sourceManifestPath = path.join(appDir, "manifest", "manifest.xml");
const distDir = path.join(appDir, "dist");
const outputManifestPath = path.join(distDir, "manifest.xml");
const baseUrl = process.env.SCOMM_OFFICE_BASE_URL ?? "https://office.scomm.ai";

const sourceManifest = await readFile(sourceManifestPath, "utf8");
const renderedManifest = sourceManifest.replaceAll("https://localhost:5173", baseUrl);

await mkdir(distDir, { recursive: true });
await writeFile(outputManifestPath, renderedManifest, "utf8");

process.stdout.write(`Rendered ${outputManifestPath} for ${baseUrl}\n`);
