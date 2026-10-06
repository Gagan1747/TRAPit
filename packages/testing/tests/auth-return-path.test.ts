import { describe, expect, it } from "vitest";

import { getSafeAuthReturnPath } from "../../../apps/web/lib/auth-return-path";

describe("auth return paths", () => {
  it("preserves local booking paths and their query strings", () => {
    expect(getSafeAuthReturnPath("/apportion/STAFF-LINK?serviceId=therapy&locationId=location-1&ownerIdentifier=%2B919111111111"))
      .toBe("/apportion/STAFF-LINK?serviceId=therapy&locationId=location-1&ownerIdentifier=%2B919111111111");
  });

  it.each([
    "https://example.com/",
    "//example.com/path",
    "/\\example.com/path",
    "/%2f%2fexample.com/path",
    "/%252f%252fexample.com/path",
    "/%5cexample.com/path",
    "/a/../admin",
    "/%2e%2e/admin",
    "/%252e%252e/admin",
    "/path%0aInjected",
    "/bad%zz",
  ])("rejects unsafe return path %s", (value) => {
    expect(getSafeAuthReturnPath(value)).toBe("");
  });
});