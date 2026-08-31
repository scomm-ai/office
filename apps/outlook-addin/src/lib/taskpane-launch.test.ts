import { describe, expect, it } from "vitest";
import { readTaskPaneLaunch } from "./taskpane-launch";

describe("readTaskPaneLaunch", () => {
  it("opens Security for decrypt/verify ribbon actions", () => {
    expect(readTaskPaneLaunch("?action=decrypt")).toEqual({
      module: "security",
      action: "decrypt",
    });
    expect(readTaskPaneLaunch("module=identity&action=verify")).toEqual({
      module: "identity",
      action: "verify",
    });
  });
});
