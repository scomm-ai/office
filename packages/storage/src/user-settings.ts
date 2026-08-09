export interface UserSettingsStore<T extends Record<string, unknown> = Record<string, unknown>> {
  get(): Promise<T | null>;
  set(settings: T): Promise<void>;
}

export class MemoryUserSettingsStore<
  T extends Record<string, unknown> = Record<string, unknown>,
> implements UserSettingsStore<T>
{
  private settings: T | null = null;

  async get(): Promise<T | null> {
    return this.settings;
  }

  async set(settings: T): Promise<void> {
    this.settings = settings;
  }

  clear(): void {
    this.settings = null;
  }
}
