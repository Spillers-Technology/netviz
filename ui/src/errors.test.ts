import { describe, expect, it } from "vitest";
import { friendlyError } from "./errors";

describe("friendlyError", () => {
  it("explains known failures and keeps the original text", () => {
    const result = friendlyError(new Error('invalid CIDR "192.168.1": invalid CIDR address'), "Starting the scan");
    expect(result.lead).toMatch(/network range isn't valid/);
    expect(result.details).toBe('invalid CIDR "192.168.1": invalid CIDR address');
  });

  it("recognizes elevation failures", () => {
    expect(friendlyError("sc.exe: Access is denied.").lead).toMatch(/administrator/);
  });

  it("falls back to naming the action", () => {
    const result = friendlyError("something odd", "Saving the scan");
    expect(result.lead).toBe("Saving the scan didn't work.");
    expect(result.details).toBe("something odd");
  });

  it("handles non-Error values", () => {
    expect(friendlyError({ message: "timeout waiting" }).lead).toMatch(/too long/);
    expect(friendlyError(undefined).details).toBe("");
  });
});
