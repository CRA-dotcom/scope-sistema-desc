"use node";
import crypto from "crypto";

export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  const secret = process.env.QUOTATION_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "QUOTATION_TOKEN_SECRET no configurado o < 32 chars."
    );
  }
  return crypto.createHmac("sha256", secret).update(token).digest("base64url");
}
