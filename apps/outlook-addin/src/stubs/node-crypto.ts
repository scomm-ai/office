/**
 * Browser stand-in for `node:crypto` so Vite can bundle SDK DeviceID helpers.
 * License JWT verify uses Web Crypto directly; this stub is only for Ed25519 SKI generation.
 */

/** Same object as `globalThis.crypto` (Web Crypto). */
export const webcrypto = globalThis.crypto;

/**
 * Fill `size` random bytes. `toString("hex")` matches Node's Buffer hex encoding.
 */
export function randomBytes(size: number): { toString: (encoding?: string) => string } {
  const out = new Uint8Array(size);
  globalThis.crypto.getRandomValues(out);
  return {
    toString(encoding?: string) {
      if (!encoding || encoding === "hex") {
        return Array.from(out, (byte) => byte.toString(16).padStart(2, "0")).join("");
      }
      throw new Error(`node:crypto randomBytes encoding "${encoding}" is unavailable in the add-in`);
    },
  };
}

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
