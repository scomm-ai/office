export const FIXTURE_NAMES = [
  "simple",
  "reply-with-quote",
  "forward",
  "signature",
  "legal-disclaimer",
  "complex-thread",
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

export function isFixtureName(name: string): name is FixtureName {
  return (FIXTURE_NAMES as readonly string[]).includes(name);
}

export function listFixtures(): FixtureName[] {
  return [...FIXTURE_NAMES];
}

export async function loadFixture(_name: FixtureName): Promise<string> {
  throw new Error("loadFixture is unavailable in browser bundles; import fixture HTML with ?raw");
}
