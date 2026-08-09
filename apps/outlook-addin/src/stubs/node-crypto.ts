export function createHash(_algorithm: string) {
  return {
    update(_input: string, _encoding?: string) {
      return this;
    },
    digest(_encoding: string) {
      throw new Error("node:crypto fallback is unavailable in browser bundles");
    },
  };
}
