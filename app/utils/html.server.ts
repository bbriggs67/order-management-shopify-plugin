/**
 * HTML Utilities
 * Secure HTML handling for app proxy templates
 */

/**
 * Escape HTML special characters to prevent XSS attacks
 *
 * @param unsafe - String that may contain unsafe HTML characters
 * @returns Escaped string safe for HTML rendering
 */
export function escapeHtml(unsafe: string | null | undefined): string {
  if (unsafe == null) return "";

  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Escape HTML attribute value
 * More strict escaping for use in HTML attributes
 *
 * @param unsafe - String to be used as an attribute value
 * @returns Escaped string safe for HTML attributes
 */
export function escapeHtmlAttribute(unsafe: string | null | undefined): string {
  if (unsafe == null) return "";

  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/`/g, "&#96;")
    .replace(/=/g, "&#61;");
}

/**
 * Create a safe HTML template literal tag
 * Use this for safe string interpolation in HTML templates
 *
 * @example
 * const name = "<script>alert('xss')</script>";
 * const html = safeHtml`<p>Hello, ${name}!</p>`;
 * // Result: <p>Hello, &lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;!</p>
 */
export function safeHtml(
  strings: TemplateStringsArray,
  ...values: (string | number | boolean | null | undefined)[]
): string {
  let result = strings[0];
  for (let i = 0; i < values.length; i++) {
    result += escapeHtml(String(values[i] ?? ""));
    result += strings[i + 1];
  }
  return result;
}

/**
 * Mark a string as already safe (pre-escaped or trusted HTML)
 * WARNING: Only use this for HTML that you control and trust
 *
 * @param html - HTML string that is already safe
 * @returns Object that can be used with safeCombine
 */
export function trustHtml(html: string): { __html: string; isSafe: true } {
  return { __html: html, isSafe: true };
}

/**
 * Check if a value is a trusted HTML object
 */
export function isTrustedHtml(value: unknown): value is { __html: string; isSafe: true } {
  return (
    typeof value === "object" &&
    value !== null &&
    "__html" in value &&
    "isSafe" in value &&
    (value as { isSafe: unknown }).isSafe === true
  );
}

/**
 * Safely combine HTML fragments, escaping untrusted values
 *
 * @example
 * const trusted = trustHtml('<strong>Bold</strong>');
 * const untrusted = '<script>alert("xss")</script>';
 * const result = safeCombine(trusted, ' - ', untrusted);
 * // Result: <strong>Bold</strong> - &lt;script&gt;alert("xss")&lt;/script&gt;
 */
export function safeCombine(
  ...parts: (string | { __html: string; isSafe: true } | null | undefined)[]
): string {
  return parts
    .map((part) => {
      if (part == null) return "";
      if (isTrustedHtml(part)) return part.__html;
      return escapeHtml(String(part));
    })
    .join("");
}
