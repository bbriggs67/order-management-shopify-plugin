/**
 * Phone number normalization for Twilio SMS integration.
 *
 * Twilio sends/expects E.164 format (+1XXXXXXXXXX for US).
 * Shopify may store phone numbers in various formats:
 *   (858) 555-1234, +1 858-555-1234, 858-555-1234, +18585551234
 *
 * This utility normalizes all formats to E.164 for reliable matching.
 */

/**
 * Normalize a phone number to E.164 format (+1XXXXXXXXXX for US).
 * Returns null if the input is empty or too short to be valid.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;

  // Strip everything except digits and leading +
  const stripped = phone.replace(/[^\d+]/g, "");

  // Extract just digits
  const digits = stripped.replace(/\D/g, "");

  if (digits.length < 10) return null;

  // Already has +country code
  if (stripped.startsWith("+")) {
    return stripped;
  }

  // 11 digits starting with 1 → US number
  if (digits.startsWith("1") && digits.length === 11) {
    return `+${digits}`;
  }

  // 10 digits → assume US, prepend +1
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // Fallback: prepend + if not already there
  return `+${digits}`;
}
