export type ScommUid = string;

export interface UidProvider {
  create(type: string): Promise<ScommUid>;
}

export class LocalUidProvider implements UidProvider {
  async create(type: string): Promise<ScommUid> {
    const rand = crypto.getRandomValues(new Uint8Array(16));
    const hex = Array.from(rand, (b) => b.toString(16).padStart(2, "0")).join("");
    return `scomm_${type}_${hex}`;
  }
}
