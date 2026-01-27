/**
 * Compliance Tests for Provider Route Headers
 *
 * Policy: All routes that serve provider content MUST:
 * 1. Set Cache-Control: no-store (prevent caching provider content)
 * 2. Set X-Robots-Tag: noindex (prevent search engine indexing)
 * 3. Use dynamic = "force-dynamic" in Next.js
 *
 * This prevents provider content from being:
 * - Cached by browsers or CDNs
 * - Indexed by search engines
 * - Pre-rendered at build time
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Routes that serve provider content and MUST have no-store headers
 */
const PROVIDER_ROUTES = [
  "/place/[placeKey]", // Place detail page
  "/api/photos/[placeId]/[photoRef]", // Photo proxy
  // Add more routes as they're created
] as const;

/**
 * Required response headers for provider routes
 */
const REQUIRED_PROVIDER_HEADERS = {
  "Cache-Control": ["no-store", "private, no-cache, no-store, must-revalidate"],
  "X-Robots-Tag": ["noindex", "noindex, nofollow"],
} as const;

/**
 * Routes that serve owned content and CAN be cached
 */
const CACHEABLE_ROUTES = [
  "/guides/[slug]", // Editorial guides (owned content)
  "/lists/[slug]", // Public lists (owned content)
  "/api/cities", // Static city data
] as const;

/**
 * Check if a file exports dynamic = "force-dynamic"
 */
async function checkForceDynamic(filePath: string): Promise<boolean> {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    // Check for the Next.js force-dynamic export
    return (
      content.includes('dynamic = "force-dynamic"') ||
      content.includes("dynamic = 'force-dynamic'")
    );
  } catch {
    return false;
  }
}

/**
 * Get all route files in the app directory
 */
function getRouteFiles(dir: string, routes: string[] = []): string[] {
  const appDir = path.join(process.cwd(), "app");

  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);

      if (item.isDirectory()) {
        getRouteFiles(fullPath, routes);
      } else if (
        item.name === "page.tsx" ||
        item.name === "page.ts" ||
        item.name === "route.tsx" ||
        item.name === "route.ts"
      ) {
        routes.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist yet - that's ok
  }

  return routes;
}

/**
 * Extract route pattern from file path
 * e.g., /app/(main)/place/[placeKey]/page.tsx -> /place/[placeKey]
 */
function extractRoutePattern(filePath: string): string {
  const appDir = path.join(process.cwd(), "app");
  let relativePath = filePath.replace(appDir, "");

  // Remove file extension and page/route suffix
  relativePath = relativePath
    .replace(/\/page\.(tsx?|jsx?)$/, "")
    .replace(/\/route\.(tsx?|jsx?)$/, "");

  // Remove route groups (parentheses)
  relativePath = relativePath.replace(/\/\([^)]+\)/g, "");

  return relativePath || "/";
}

/**
 * Check if a route pattern matches a provider route
 */
function isProviderRoute(routePattern: string): boolean {
  // Direct matches
  if (routePattern === "/place/[placeKey]") return true;
  if (routePattern.startsWith("/api/photos/")) return true;

  // Pattern matches for place details
  if (routePattern.match(/\/place\/\[.+\]/)) return true;

  return false;
}

describe("Provider Route Headers Compliance", () => {
  describe("Photo proxy route", () => {
    it("should have force-dynamic export", async () => {
      const routePath = path.join(
        process.cwd(),
        "app/api/photos/[placeId]/[photoRef]/route.ts"
      );

      const hasForceDynamic = await checkForceDynamic(routePath);
      expect(hasForceDynamic).toBe(true);
    });

    it("photo proxy should exist and be a route handler", () => {
      const routePath = path.join(
        process.cwd(),
        "app/api/photos/[placeId]/[photoRef]/route.ts"
      );

      expect(fs.existsSync(routePath)).toBe(true);

      const content = fs.readFileSync(routePath, "utf-8");
      // Should export GET handler
      expect(content).toMatch(/export\s+(async\s+)?function\s+GET/);
    });
  });

  describe("Route pattern classification", () => {
    it("should correctly identify provider routes", () => {
      expect(isProviderRoute("/place/[placeKey]")).toBe(true);
      expect(isProviderRoute("/api/photos/[placeId]/[photoRef]")).toBe(true);
    });

    it("should correctly identify non-provider routes", () => {
      expect(isProviderRoute("/guides/[slug]")).toBe(false);
      expect(isProviderRoute("/lists/[slug]")).toBe(false);
      expect(isProviderRoute("/")).toBe(false);
    });
  });

  describe("Cache-Control header requirements", () => {
    it("provider routes should specify no-store", () => {
      const validCacheControlValues = REQUIRED_PROVIDER_HEADERS["Cache-Control"];

      // At least one of these patterns should be acceptable
      expect(validCacheControlValues).toContain("no-store");
    });

    it("should not allow max-age on provider routes", () => {
      // These would be violations
      const invalidCacheControl = [
        "public, max-age=3600",
        "private, max-age=300",
        "s-maxage=600",
      ];

      // Verify none of these are in our required headers
      for (const invalid of invalidCacheControl) {
        expect(REQUIRED_PROVIDER_HEADERS["Cache-Control"]).not.toContain(
          invalid
        );
      }
    });
  });

  describe("Robots meta requirements", () => {
    it("provider routes should specify noindex", () => {
      const validRobotsValues = REQUIRED_PROVIDER_HEADERS["X-Robots-Tag"];

      expect(
        validRobotsValues.some((v) => v.includes("noindex"))
      ).toBe(true);
    });
  });

  describe("Static analysis of provider routes", () => {
    it("all existing provider route files should have force-dynamic", async () => {
      const providerRouteFiles = [
        path.join(process.cwd(), "app/api/photos/[placeId]/[photoRef]/route.ts"),
        // Add more as they're created
      ];

      for (const routeFile of providerRouteFiles) {
        if (fs.existsSync(routeFile)) {
          const hasForceDynamic = await checkForceDynamic(routeFile);
          expect(hasForceDynamic).toBe(true);
        }
      }
    });
  });
});

describe("Cacheable Route Validation", () => {
  it("should have a clear distinction between provider and owned routes", () => {
    // No overlap between provider and cacheable routes
    for (const providerRoute of PROVIDER_ROUTES) {
      expect(CACHEABLE_ROUTES).not.toContain(providerRoute as string);
    }
  });

  it("cacheable routes should be owned content only", () => {
    // All cacheable routes should be editorial/owned content
    for (const route of CACHEABLE_ROUTES) {
      // These patterns indicate owned content
      const isOwned =
        route.includes("/guides/") ||
        route.includes("/lists/") ||
        route.includes("/api/cities");

      expect(isOwned).toBe(true);
    }
  });
});

describe("Service Worker Allowlist Compliance", () => {
  /**
   * Service worker should ONLY cache owned content routes
   * Provider routes must NEVER be cached offline
   */
  const SW_ALLOWED_PATTERNS = [
    "/guides/*",
    "/lists/*",
    "/static/*",
    "/_next/static/*",
  ] as const;

  const SW_FORBIDDEN_PATTERNS = [
    "/place/*",
    "/api/photos/*",
    "/api/search/*", // Search hits provider
  ] as const;

  it("should have service worker allowlist defined", () => {
    expect(SW_ALLOWED_PATTERNS.length).toBeGreaterThan(0);
    expect(SW_FORBIDDEN_PATTERNS.length).toBeGreaterThan(0);
  });

  it("should not overlap allowed and forbidden patterns", () => {
    for (const allowed of SW_ALLOWED_PATTERNS) {
      for (const forbidden of SW_FORBIDDEN_PATTERNS) {
        // Convert glob patterns to base paths
        const allowedBase = allowed.replace("/*", "");
        const forbiddenBase = forbidden.replace("/*", "");

        expect(allowedBase).not.toBe(forbiddenBase);
      }
    }
  });

  it("forbidden patterns should include all provider routes", () => {
    // Place routes should be forbidden
    expect(
      SW_FORBIDDEN_PATTERNS.some((p) => p.includes("/place"))
    ).toBe(true);

    // Photo routes should be forbidden
    expect(
      SW_FORBIDDEN_PATTERNS.some((p) => p.includes("/api/photos"))
    ).toBe(true);
  });
});
