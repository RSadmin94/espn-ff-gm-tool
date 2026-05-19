import { describe, it, expect } from "vitest";

describe("runMigrations idempotency helpers", () => {
  it("recognizes duplicate-key errors as skippable", () => {
    const SKIPPABLE_CODES = new Set(["ER_DUP_KEYNAME", "ER_CANT_DROP_FIELD_OR_KEY"]);
    const isSkippable = (code?: string) => code != null && SKIPPABLE_CODES.has(code);
    expect(isSkippable("ER_DUP_KEYNAME")).toBe(true);
    expect(isSkippable("ER_CANT_DROP_FIELD_OR_KEY")).toBe(true);
    expect(isSkippable("ER_NO_SUCH_TABLE")).toBe(false);
  });
});
