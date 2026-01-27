/**
 * Environment Configuration & Validation
 *
 * This module provides:
 * 1. Type-safe access to environment variables
 * 2. Runtime validation to catch misconfigurations early
 * 3. Environment identification (dev/staging/production)
 *
 * @see .env.example for environment setup documentation
 */

// =============================================================================
// Environment Types
// =============================================================================

export type Environment = "development" | "preview" | "production";

export interface EnvConfig {
  // Core identifiers
  environment: Environment;
  isProduction: boolean;
  isStaging: boolean;
  isDevelopment: boolean;

  // Convex
  convexUrl: string;

  // Google Maps (browser-side only)
  googleMapsApiKey: string;

  // App info
  appName: string;
  appVersion: string;
}

// =============================================================================
// Environment Detection
// =============================================================================

/**
 * Detect current environment from Vercel env or NODE_ENV
 */
function detectEnvironment(): Environment {
  // Vercel sets VERCEL_ENV
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.VERCEL_ENV;

  if (vercelEnv === "production") return "production";
  if (vercelEnv === "preview") return "preview";

  // Fallback to NODE_ENV
  if (process.env.NODE_ENV === "production") return "production";

  return "development";
}

// =============================================================================
// Validation Helpers
// =============================================================================

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
        `See .env.example for configuration instructions.`
    );
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

// =============================================================================
// Environment Configuration
// =============================================================================

let _envConfig: EnvConfig | null = null;

/**
 * Get validated environment configuration.
 * Call this early in app initialization to catch config errors.
 */
export function getEnvConfig(): EnvConfig {
  if (_envConfig) return _envConfig;

  const environment = detectEnvironment();

  _envConfig = {
    // Core identifiers
    environment,
    isProduction: environment === "production",
    isStaging: environment === "preview",
    isDevelopment: environment === "development",

    // Convex - required for app to function
    convexUrl: requireEnv("NEXT_PUBLIC_CONVEX_URL"),

    // Google Maps - required for map features
    googleMapsApiKey: requireEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"),

    // App info
    appName: optionalEnv("NEXT_PUBLIC_APP_NAME", "Morocco Eats"),
    appVersion: optionalEnv("NEXT_PUBLIC_APP_VERSION", "0.0.0"),
  };

  return _envConfig;
}

/**
 * Validate environment configuration at build/startup time.
 * Returns array of warnings (non-fatal issues) and throws on fatal errors.
 */
export function validateEnv(): string[] {
  const warnings: string[] = [];
  const config = getEnvConfig();

  // Check for placeholder values that weren't replaced
  if (config.convexUrl.includes("your-deployment")) {
    throw new Error(
      "NEXT_PUBLIC_CONVEX_URL contains placeholder value. " +
        "Run 'bunx convex dev' to generate your deployment URL."
    );
  }

  if (config.googleMapsApiKey.includes("your-")) {
    throw new Error(
      "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY contains placeholder value. " +
        "Set up your Google Cloud API key."
    );
  }

  // Warn about potential environment mismatches
  if (config.isProduction) {
    if (config.convexUrl.includes("dev:")) {
      warnings.push(
        "Production environment is using a development Convex deployment. " +
          "Set CONVEX_DEPLOYMENT to a production project."
      );
    }
  }

  // Warn if staging appears to share production resources
  if (config.isStaging) {
    // Note: Can't detect shared API keys at runtime, but can check Convex URL
    if (config.convexUrl.includes("-prod")) {
      warnings.push(
        "Staging environment appears to be using production Convex. " +
          "Consider using a separate staging project."
      );
    }
  }

  return warnings;
}

// =============================================================================
// Convenience Exports
// =============================================================================

/**
 * Quick check if running in production
 */
export function isProduction(): boolean {
  return getEnvConfig().isProduction;
}

/**
 * Quick check if running in development
 */
export function isDevelopment(): boolean {
  return getEnvConfig().isDevelopment;
}

/**
 * Get current environment name
 */
export function getEnvironment(): Environment {
  return getEnvConfig().environment;
}
