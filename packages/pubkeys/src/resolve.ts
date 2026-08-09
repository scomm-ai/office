import { createEmailIdentity } from "@scomm-office/identity";
import type { PublicKeyRecord } from "@scomm-office/protocol";
import type { PublicKeyDirectory } from "./directory.js";
import { filterUsableKeys } from "./filter.js";

export async function resolveRecipientKeys(
  dir: PublicKeyDirectory,
  email: string,
): Promise<PublicKeyRecord[]> {
  const identity = createEmailIdentity(email);
  const keys = await dir.getKeys(identity);
  return filterUsableKeys(keys).filter((record) => record.purpose === "encryption");
}

export async function resolveSenderKeys(
  dir: PublicKeyDirectory,
  email: string,
): Promise<PublicKeyRecord[]> {
  const identity = createEmailIdentity(email);
  const keys = await dir.getKeys(identity);
  return filterUsableKeys(keys).filter((record) => record.purpose === "signing");
}
