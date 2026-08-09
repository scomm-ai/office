export interface MailAddress {
  name?: string;
  address: string;
}

export const sampleMailAddresses = {
  alice: { name: "Alice Example", address: "alice@example.com" } satisfies MailAddress,
  bob: { name: "Bob Smith", address: "bob@example.com" } satisfies MailAddress,
  carol: { address: "carol@example.org" } satisfies MailAddress,
  support: { name: "Support", address: "support@scomm.example" } satisfies MailAddress,
  noReply: { name: "No Reply", address: "noreply@example.com" } satisfies MailAddress,
} as const;

export type SampleMailAddressKey = keyof typeof sampleMailAddresses;

export function getSampleMailAddress(key: SampleMailAddressKey): MailAddress {
  return sampleMailAddresses[key];
}

export function formatMailAddress(addr: MailAddress): string {
  return addr.name ? `${addr.name} <${addr.address}>` : addr.address;
}
