export interface CloudAiKeyStore {
  readApiKey(profileId: string): Promise<string | null>;
  writeApiKey(profileId: string, apiKey: string): Promise<void>;
  deleteApiKey(profileId: string): Promise<void>;
}

const KEY_PREFIX = "scomm-office.byoai.key.v1:";

export class LocalStorageCloudAiKeyStore implements CloudAiKeyStore {
  constructor(private readonly storage: Storage = localStorage) {}

  async readApiKey(profileId: string): Promise<string | null> {
    return this.storage.getItem(`${KEY_PREFIX}${profileId}`);
  }

  async writeApiKey(profileId: string, apiKey: string): Promise<void> {
    this.storage.setItem(`${KEY_PREFIX}${profileId}`, apiKey);
  }

  async deleteApiKey(profileId: string): Promise<void> {
    this.storage.removeItem(`${KEY_PREFIX}${profileId}`);
  }
}

export class InMemoryCloudAiKeyStore implements CloudAiKeyStore {
  private readonly keys = new Map<string, string>();

  async readApiKey(profileId: string): Promise<string | null> {
    return this.keys.get(profileId) ?? null;
  }

  async writeApiKey(profileId: string, apiKey: string): Promise<void> {
    this.keys.set(profileId, apiKey);
  }

  async deleteApiKey(profileId: string): Promise<void> {
    this.keys.delete(profileId);
  }
}
