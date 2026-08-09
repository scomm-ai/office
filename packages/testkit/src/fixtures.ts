import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_NAMES = [
  "simple",
  "reply-with-quote",
  "forward",
  "signature",
  "legal-disclaimer",
  "complex-thread",
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

export function isFixtureName(name: string): name is FixtureName {
  return (FIXTURE_NAMES as readonly string[]).includes(name);
}

export async function loadFixture(name: FixtureName): Promise<string> {
  const filePath = path.join(fixturesDir, `${name}.html`);
  return readFile(filePath, "utf8");
}

export function listFixtures(): FixtureName[] {
  return [...FIXTURE_NAMES];
}

export { FIXTURE_NAMES };
