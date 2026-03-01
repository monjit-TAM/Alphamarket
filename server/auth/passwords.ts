import bcrypt from "bcryptjs";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

/**
 * Hash a password using bcrypt (standard going forward).
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Compare a plaintext password against a stored hash.
 * Supports both bcrypt ($2b$...) and legacy scrypt formats for backward compatibility.
 */
export async function comparePasswords(
  supplied: string,
  stored: string
): Promise<boolean> {
  // bcrypt hashes start with $2a$ or $2b$
  if (stored.startsWith("$2a$") || stored.startsWith("$2b$")) {
    return bcrypt.compare(supplied, stored);
  }

  // Legacy scrypt format: hex(salt).hex(hash)
  if (stored.includes(".")) {
    const [salt, hash] = stored.split(".");
    const derivedKey = (await scryptAsync(supplied, salt, 64)) as Buffer;
    const storedHash = Buffer.from(hash, "hex");
    return timingSafeEqual(derivedKey, storedHash);
  }

  return false;
}
