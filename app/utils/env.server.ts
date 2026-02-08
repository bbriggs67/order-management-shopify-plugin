/**
 * Environment Variable Validation
 * Validates required environment variables at startup
 */

// Required environment variables for core functionality
const REQUIRED_ENV_VARS = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "DATABASE_URL",
] as const;

// Optional environment variables with their purpose
const OPTIONAL_ENV_VARS = {
  // Twilio for SMS notifications
  TWILIO_ACCOUNT_SID: "Twilio SMS integration",
  TWILIO_AUTH_TOKEN: "Twilio SMS integration",
  TWILIO_PHONE_NUMBER: "Twilio SMS integration",
  // SendGrid for email notifications
  SENDGRID_API_KEY: "SendGrid email integration",
  SENDGRID_FROM_EMAIL: "SendGrid email integration",
  // Google Calendar
  GOOGLE_CLIENT_ID: "Google Calendar integration",
  GOOGLE_CLIENT_SECRET: "Google Calendar integration",
  GOOGLE_REDIRECT_URI: "Google Calendar integration",
  // Cron job security
  CRON_SECRET: "Cron job authentication",
  // Custom domain
  SHOP_CUSTOM_DOMAIN: "Custom shop domain",
} as const;

interface EnvValidationResult {
  isValid: boolean;
  missing: string[];
  warnings: string[];
}

/**
 * Validate that all required environment variables are set
 * Returns validation result with missing vars and warnings
 */
export function validateEnv(): EnvValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Check required vars
  for (const envVar of REQUIRED_ENV_VARS) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }

  // Check optional vars and warn about missing integrations
  const integrationGroups: Record<string, string[]> = {
    "Twilio SMS": ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"],
    "SendGrid Email": ["SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL"],
    "Google Calendar": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"],
  };

  for (const [integration, vars] of Object.entries(integrationGroups)) {
    const hasAny = vars.some((v) => process.env[v]);
    const hasAll = vars.every((v) => process.env[v]);

    if (hasAny && !hasAll) {
      const missingVars = vars.filter((v) => !process.env[v]);
      warnings.push(`${integration} is partially configured. Missing: ${missingVars.join(", ")}`);
    }
  }

  // Warn if no cron secret is set
  if (!process.env.CRON_SECRET) {
    warnings.push("CRON_SECRET is not set - cron endpoints will be accessible without authentication");
  }

  return {
    isValid: missing.length === 0,
    missing,
    warnings,
  };
}

/**
 * Get a required environment variable, throwing if not set
 */
export function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

/**
 * Get an optional environment variable with a default value
 */
export function getOptionalEnv(name: string, defaultValue: string = ""): string {
  return process.env[name] || defaultValue;
}

/**
 * Check if an integration is fully configured
 */
export function isIntegrationConfigured(integration: "twilio" | "sendgrid" | "google"): boolean {
  switch (integration) {
    case "twilio":
      return !!(
        process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.TWILIO_PHONE_NUMBER
      );
    case "sendgrid":
      return !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL);
    case "google":
      return !!(
        process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.GOOGLE_REDIRECT_URI
      );
    default:
      return false;
  }
}

/**
 * Log environment validation results (call at app startup)
 */
export function logEnvValidation(): void {
  const result = validateEnv();

  if (!result.isValid) {
    console.error("❌ Missing required environment variables:", result.missing.join(", "));
  }

  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      console.warn("⚠️", warning);
    }
  }

  if (result.isValid && result.warnings.length === 0) {
    console.log("✅ All environment variables validated");
  }
}
