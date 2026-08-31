export const COMPOSE_ENCRYPT_PROP = "scomm.encrypt";
export const COMPOSE_SIGN_PROP = "scomm.sign";

export interface ComposeProtectionToggles {
  sign: boolean;
  encrypt: boolean;
}

export const DEFAULT_COMPOSE_TOGGLES: ComposeProtectionToggles = {
  sign: false,
  encrypt: false,
};

export function parseToggle(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function serializeToggle(value: boolean): string {
  return value ? "1" : "0";
}

export interface ComposeToggleBag {
  get(name: string): unknown;
  set(name: string, value: string): void;
}

export function readTogglesFromBag(bag: ComposeToggleBag | null | undefined): ComposeProtectionToggles {
  if (!bag) return { ...DEFAULT_COMPOSE_TOGGLES };
  return {
    encrypt: parseToggle(bag.get(COMPOSE_ENCRYPT_PROP)),
    sign: parseToggle(bag.get(COMPOSE_SIGN_PROP)),
  };
}

export function writeTogglesToBag(bag: ComposeToggleBag, toggles: ComposeProtectionToggles): void {
  bag.set(COMPOSE_ENCRYPT_PROP, serializeToggle(toggles.encrypt));
  bag.set(COMPOSE_SIGN_PROP, serializeToggle(toggles.sign));
}

type CustomProps = {
  get: (name: string) => unknown;
  set: (name: string, value: string) => void;
  saveAsync: (callback: (result: { status: string | number }) => void) => void;
};

type ComposeItem = {
  loadCustomPropertiesAsync?: (callback: (result: { status: string | number; value?: CustomProps }) => void) => void;
};

function succeeded(status: string | number | undefined): boolean {
  return String(status).toLowerCase() === "succeeded" || status === 0;
}

export async function loadComposeTogglesFromItem(
  item: ComposeItem | null | undefined,
): Promise<ComposeProtectionToggles> {
  if (!item?.loadCustomPropertiesAsync) return { ...DEFAULT_COMPOSE_TOGGLES };
  try {
    const props = await new Promise<CustomProps>((resolve, reject) => {
      item.loadCustomPropertiesAsync!((result) => {
        if (succeeded(result.status) && result.value) resolve(result.value);
        else reject(new Error("custom properties unavailable"));
      });
    });
    return readTogglesFromBag(props);
  } catch {
    return { ...DEFAULT_COMPOSE_TOGGLES };
  }
}

export async function saveComposeTogglesToItem(
  item: ComposeItem | null | undefined,
  toggles: ComposeProtectionToggles,
): Promise<void> {
  if (!item?.loadCustomPropertiesAsync) return;
  const props = await new Promise<CustomProps>((resolve, reject) => {
    item.loadCustomPropertiesAsync!((result) => {
      if (succeeded(result.status) && result.value) resolve(result.value);
      else reject(new Error("custom properties unavailable"));
    });
  });
  writeTogglesToBag(props, toggles);
  await new Promise<void>((resolve, reject) => {
    props.saveAsync((result) => {
      if (succeeded(result.status)) resolve();
      else reject(new Error("could not save compose security toggles"));
    });
  });
}
