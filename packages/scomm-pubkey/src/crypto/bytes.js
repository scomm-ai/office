/**
 * Overwrite a buffer in place. JavaScript cannot guarantee that the garbage
 * collector, WASM copies, or the JS engine have no remaining copies.
 *
 * @param {Uint8Array | undefined | null} bytes
 */
export function wipeBytes(bytes) {
	if (!bytes) return;
	bytes.fill(0);
}
