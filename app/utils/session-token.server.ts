/**
 * Shopify Session Token Verification
 *
 * Verifies JWT session tokens from Shopify Customer Account UI Extensions.
 * Tokens are signed with HS256 using the app's SHOPIFY_API_SECRET.
 *
 * Token payload contains:
 * - iss: "https://{shop}.myshopify.com/admin"
 * - dest: "https://{shop}.myshopify.com"
 * - aud: App client ID (SHOPIFY_API_KEY)
 * - sub: Customer GID "gid://shopify/Customer/12345" (when logged in)
 * - exp: Expiration timestamp (5 min)
 * - nbf: Not before timestamp
 * - iat: Issued at timestamp
 * - jti: Unique token ID
 */

import crypto from "crypto";

export interface SessionTokenPayload {
  iss: string;
  dest: string;
  aud: string;
  sub: string;
  exp: number;
  nbf: number;
  iat: number;
  jti: string;
}

export interface VerifiedSession {
  shop: string; // e.g., "susiessourdough.myshopify.com"
  customerGid: string; // e.g., "gid://shopify/Customer/12345"
  payload: SessionTokenPayload;
}

/**
 * Verify a Shopify session token JWT and return the decoded payload.
 * Throws an error if verification fails.
 */
export function verifyCustomerSessionToken(token: string): VerifiedSession {
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  const apiKey = process.env.SHOPIFY_API_KEY;

  if (!apiSecret) {
    throw new Error("SHOPIFY_API_SECRET not configured");
  }
  if (!apiKey) {
    throw new Error("SHOPIFY_API_KEY not configured");
  }

  // Split JWT into parts
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Verify signature (HS256)
  const signatureInput = `${headerB64}.${payloadB64}`;
  const expectedSignature = crypto
    .createHmac("sha256", apiSecret)
    .update(signatureInput)
    .digest("base64url");

  // Timing-safe comparison to prevent timing attacks
  const sigBuffer = Buffer.from(signatureB64, "base64url");
  const expectedBuffer = Buffer.from(expectedSignature, "base64url");

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid JWT signature");
  }

  // Decode header and verify algorithm
  const header = JSON.parse(
    Buffer.from(headerB64, "base64url").toString("utf-8")
  );
  if (header.alg !== "HS256") {
    throw new Error(`Unsupported JWT algorithm: ${header.alg}`);
  }

  // Decode payload
  const payload: SessionTokenPayload = JSON.parse(
    Buffer.from(payloadB64, "base64url").toString("utf-8")
  );

  // Validate expiration (with 10 second grace period for clock skew)
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp + 10) {
    throw new Error("JWT has expired");
  }

  // Validate not-before
  if (payload.nbf && now < payload.nbf - 10) {
    throw new Error("JWT not yet valid");
  }

  // Validate audience matches our app
  if (payload.aud !== apiKey) {
    throw new Error(
      `JWT audience mismatch: expected ${apiKey}, got ${payload.aud}`
    );
  }

  // Extract shop domain from dest (e.g., "https://shop.myshopify.com" → "shop.myshopify.com")
  let shop = payload.dest;
  if (shop.startsWith("https://")) {
    shop = shop.replace("https://", "");
  }
  if (shop.startsWith("http://")) {
    shop = shop.replace("http://", "");
  }
  // Remove trailing slash
  shop = shop.replace(/\/$/, "");

  // Validate customer GID exists
  if (!payload.sub) {
    throw new Error("JWT missing customer identifier (sub claim)");
  }

  return {
    shop,
    customerGid: payload.sub,
    payload,
  };
}
