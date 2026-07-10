import { describe, expect, it } from "vitest";
import { TokenService, hashPassword, verifyPassword } from "./security.js";

describe("password security", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toContain("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });
});

describe("access tokens", () => {
  it("issues a verifiable scoped token", async () => {
    const service = new TokenService("a-test-secret-that-is-definitely-long-enough");
    const token = await service.issue({ accountId: "account-1", username: "river" });
    await expect(service.verify(token)).resolves.toEqual({
      accountId: "account-1",
      username: "river",
    });
  });
});
