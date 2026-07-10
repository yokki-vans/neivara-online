import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import {
  TokenService,
  hashPassword,
  verifyLoginPassword,
  verifyPassword,
} from "./security.js";

describe("password security", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toContain("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });

  it("runs the dummy verification path for an unknown account", async () => {
    await expect(verifyLoginPassword("plausible-password", null)).resolves.toBe(false);
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

  it("rejects a correctly signed token that uses a non-HS256 algorithm", async () => {
    const secret = "a-test-secret-that-is-definitely-long-enough";
    const token = await new SignJWT({ username: "river" })
      .setProtectedHeader({ alg: "HS384", typ: "JWT" })
      .setSubject("account-1")
      .setIssuer("neivara-server")
      .setAudience("neivara-client")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(secret));

    await expect(new TokenService(secret).verify(token)).rejects.toThrow();
  });
});
