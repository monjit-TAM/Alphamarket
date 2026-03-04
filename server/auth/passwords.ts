import bcrypt from "bcryptjs";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePasswords(
  supplied: string,
  stored: string
): Promise<boolean> {
  if (!stored) return false;

  if (stored.startsWith("$2a$") || stored.startsWith("$2b$")) {
    return bcrypt.compare(supplied, stored);
  }

  if (stored.includes(".")) {
    try {
      const [salt, hash] = stored.split(".");
      if (!salt || !hash) return false;
      const storedHash = Buffer.from(hash, "hex");
      const derivedKey = (await scryptAsync(supplied, salt, storedHash.length)) as Buffer;
      if (derivedKey.length !== storedHash.length) return false;
      return timingSafeEqual(derivedKey, storedHash);
    } catch {
      return false;
    }
  }

  return false;
}
