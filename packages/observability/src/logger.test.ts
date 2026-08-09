import { describe, expect, it, vi } from "vitest";
import { createLogger, redact } from "./logger.js";

describe("redact", () => {
  it("redacts sensitive keys by default", () => {
    const result = redact({
      event: "pubkey.lookup",
      accessToken: "secret-token",
      identityType: "email",
      body: "full message body",
    });
    expect(result.accessToken).toBe("[REDACTED]");
    expect(result.body).toBe("[REDACTED]");
    expect(result.identityType).toBe("email");
  });

  it("redacts nested sensitive keys", () => {
    const result = redact({
      headers: { Authorization: "Bearer abc", "X-Test": "ok" },
    });
    expect(result.headers.Authorization).toBe("[REDACTED]");
    expect(result.headers["X-Test"]).toBe("ok");
  });

  it("supports custom key lists", () => {
    const result = redact({ customSecret: "value", visible: "ok" }, ["customSecret"]);
    expect(result.customSecret).toBe("[REDACTED]");
    expect(result.visible).toBe("ok");
  });
});

describe("createLogger", () => {
  it("JSON-stringifies structured log output", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = createLogger("test");
    logger.info("pubkey.lookup", { identityType: "email", resultCount: 2 });

    expect(infoSpy).toHaveBeenCalledOnce();
    const line = infoSpy.mock.calls[0]?.[0];
    expect(typeof line).toBe("string");
    const parsed = JSON.parse(String(line));
    expect(parsed.logger).toBe("test");
    expect(parsed.message).toBe("pubkey.lookup");
    expect(parsed.identityType).toBe("email");
    expect(parsed.resultCount).toBe(2);

    infoSpy.mockRestore();
  });

  it("never logs tokens in output", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const logger = createLogger("secure");
    logger.info("auth", { token: "must-not-appear" });

    const parsed = JSON.parse(String(infoSpy.mock.calls[0]?.[0]));
    expect(parsed.token).toBe("[REDACTED]");
    infoSpy.mockRestore();
  });
});
