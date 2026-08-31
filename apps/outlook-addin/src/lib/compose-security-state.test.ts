import { describe, expect, it } from "vitest";
import {
  COMPOSE_ENCRYPT_PROP,
  parseToggle,
  readTogglesFromBag,
  writeTogglesToBag,
} from "./compose-security-state";

describe("compose security toggles", () => {
  it("parses stored flags", () => {
    expect(parseToggle("1")).toBe(true);
    expect(parseToggle("0")).toBe(false);
    expect(parseToggle(undefined)).toBe(false);
  });

  it("round-trips through a property bag", () => {
    const store = new Map<string, string>();
    const bag = {
      get: (name: string) => store.get(name),
      set: (name: string, value: string) => {
        store.set(name, value);
      },
    };
    writeTogglesToBag(bag, { encrypt: true, sign: true });
    expect(store.get(COMPOSE_ENCRYPT_PROP)).toBe("1");
    expect(readTogglesFromBag(bag)).toEqual({ encrypt: true, sign: true });
  });
});
