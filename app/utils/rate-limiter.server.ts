/**
 * Simple in-memory rate limiter
 * For production, consider using Redis or a proper rate limiting service
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store for rate limits (resets on server restart)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up old entries periodically to prevent memory leaks
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Number of remaining requests in the current window */
  remaining: number;
  /** Unix timestamp when the rate limit resets */
  resetAt: number;
  /** Seconds until the rate limit resets */
  retryAfter: number;
}

/**
 * Default rate limit configs for different use cases
 */
export const RATE_LIMITS = {
  /** Customer portal - generous limits for normal use */
  CUSTOMER_PORTAL: {
    maxRequests: 30,
    windowMs: 60 * 1000, // 30 requests per minute
  },
  /** Form submissions - more restrictive */
  FORM_SUBMISSION: {
    maxRequests: 10,
    windowMs: 60 * 1000, // 10 submissions per minute
  },
  /** API endpoints */
  API: {
    maxRequests: 100,
    windowMs: 60 * 1000, // 100 requests per minute
  },
} as const;

/**
 * Check if a request should be rate limited
 *
 * @param key - Unique identifier for the rate limit (e.g., IP address, user ID, email)
 * @param config - Rate limit configuration
 * @returns Rate limit result with allowed status and metadata
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  // If no entry or entry has expired, create a new one
  if (!entry || entry.resetAt < now) {
    const newEntry: RateLimitEntry = {
      count: 1,
      resetAt: now + config.windowMs,
    };
    rateLimitStore.set(key, newEntry);

    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetAt: newEntry.resetAt,
      retryAfter: 0,
    };
  }

  // Increment count
  entry.count++;
  rateLimitStore.set(key, entry);

  const remaining = Math.max(0, config.maxRequests - entry.count);
  const retryAfter = Math.ceil((entry.resetAt - now) / 1000);

  return {
    allowed: entry.count <= config.maxRequests,
    remaining,
    resetAt: entry.resetAt,
    retryAfter,
  };
}

/**
 * Generate a rate limit key for the customer portal
 * Uses shop + customer email to scope rate limits
 */
export function getCustomerPortalRateLimitKey(shop: string, customerEmail: string): string {
  return `customer-portal:${shop}:${customerEmail.toLowerCase()}`;
}

/**
 * Generate a rate limit key for form submissions
 * More restrictive - uses shop + email + action
 */
export function getFormSubmissionRateLimitKey(
  shop: string,
  customerEmail: string,
  action: string
): string {
  return `form-submit:${shop}:${customerEmail.toLowerCase()}:${action}`;
}

/**
 * Reset rate limit for a specific key (useful for testing or admin overrides)
 */
export function resetRateLimit(key: string): void {
  rateLimitStore.delete(key);
}

/**
 * Get current rate limit status without incrementing
 */
export function getRateLimitStatus(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt < now) {
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetAt: now + config.windowMs,
      retryAfter: 0,
    };
  }

  const remaining = Math.max(0, config.maxRequests - entry.count);
  const retryAfter = Math.ceil((entry.resetAt - now) / 1000);

  return {
    allowed: entry.count < config.maxRequests,
    remaining,
    resetAt: entry.resetAt,
    retryAfter,
  };
}
