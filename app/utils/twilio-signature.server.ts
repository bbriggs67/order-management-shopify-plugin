/**
 * Twilio webhook signature validation.
 *
 * Twilio signs every webhook request with HMAC-SHA1 using your Auth Token.
 * The signature is sent in the X-Twilio-Signature header.
 *
 * Algorithm (from Twilio docs):
 * 1. Take the full URL of the request
 * 2. Sort POST params alphabetically by key
 * 3. Append each key-value pair to the URL (no separators)
 * 4. HMAC-SHA1 the result with your Auth Token
 * 5. Base64-encode the hash
 * 6. Compare with X-Twilio-Signature header
 *
 * Uses Node's built-in crypto module (no twilio npm package needed).
 */

import crypto from "crypto";

/**
 * Validate a Twilio webhook signature.
 *
 * @param authToken - Your Twilio Auth Token
 * @param signature - Value of the X-Twilio-Signature header
 * @param url - The full URL Twilio sent the request to
 * @param params - The POST parameters as key-value pairs
 * @returns true if the signature is valid
 */
export function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  if (!authToken || !signature || !url) {
    return false;
  }

  // Build the data string: URL + sorted key-value pairs concatenated
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  // Compute HMAC-SHA1
  const expectedSignature = crypto
    .createHmac("sha1", authToken)
    .update(data, "utf-8")
    .digest("base64");

  // Timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    // Buffers have different lengths → signatures don't match
    return false;
  }
}
