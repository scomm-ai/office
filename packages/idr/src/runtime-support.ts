import type { IdrRuntimeSupport } from "./transport.js";

async function probeEd25519(): Promise<boolean> {
  if (typeof globalThis.crypto?.subtle?.generateKey !== "function") {
    return false;
  }

  try {
    await globalThis.crypto.subtle.generateKey(
      { name: "Ed25519" },
      false,
      ["sign", "verify"],
    );
    return true;
  } catch {
    return false;
  }
}

export async function detectIdrRuntimeSupport(): Promise<IdrRuntimeSupport> {
  const webRtc = typeof globalThis.RTCPeerConnection !== "undefined";
  const webCryptoEd25519 = await probeEd25519();

  let status: IdrRuntimeSupport["status"] = "supported";
  if (!webRtc && !webCryptoEd25519) {
    status = "blocked";
  } else if (!webRtc || !webCryptoEd25519) {
    status = "unsupported";
  }

  return { webRtc, webCryptoEd25519, status };
}
