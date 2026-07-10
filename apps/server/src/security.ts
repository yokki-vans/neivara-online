import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, jwtVerify } from "jose";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const DUMMY_PASSWORD_HASH = `scrypt:${Buffer.alloc(16).toString("base64url")}:${Buffer.alloc(
  KEY_LENGTH,
).toString("base64url")}`;

export interface AccessClaims {
  accountId: string;
  username: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt:${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltText, hashText] = encoded.split(":");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;

  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(hashText, "base64url");
    const actual = (await scrypt(password, salt, expected.length)) as Buffer;
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Always performs scrypt so a missing username does not create a cheap timing oracle. */
export async function verifyLoginPassword(
  password: string,
  encodedHash: string | null,
): Promise<boolean> {
  const valid = await verifyPassword(password, encodedHash ?? DUMMY_PASSWORD_HASH);
  return encodedHash !== null && valid;
}

export class TokenService {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  async issue(claims: AccessClaims): Promise<string> {
    return new SignJWT({ username: claims.username })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(claims.accountId)
      .setIssuer("neivara-server")
      .setAudience("neivara-client")
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(this.key);
  }

  async verify(token: string): Promise<AccessClaims> {
    const { payload } = await jwtVerify(token, this.key, {
      issuer: "neivara-server",
      audience: "neivara-client",
      algorithms: ["HS256"],
    });

    if (!payload.sub || typeof payload.username !== "string") {
      throw new Error("Invalid access token payload");
    }

    return { accountId: payload.sub, username: payload.username };
  }
}
