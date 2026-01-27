import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import {
  verifySignature,
  buildGooglePhotoUrl,
  PHOTO_SIZE_MAP,
  type PhotoSize,
} from "@/lib/photoUrls";

/**
 * Photo Proxy Route Handler
 *
 * Policy-compliant Google Places photo serving:
 * - Never persists photo bytes to DB/storage
 * - Short TTL caching via CDN
 * - API key never exposed to client
 * - Signed URLs prevent hotlinking
 * - Full ProviderGateway integration:
 *   - Budget tracking and enforcement
 *   - Circuit breaker checks
 *   - Metrics logging (redacted, safe metadata only)
 */

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{
    placeId: string;
    photoRef: string;
  }>;
}

/**
 * Generate a unique request ID for tracking
 */
function generateRequestId(): string {
  return `photo_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Emit safe, redacted metrics for photo proxy calls.
 * NOTE: Never log photo URLs, placeIds, or any provider content.
 */
function emitPhotoMetric(metadata: {
  requestId: string;
  success: boolean;
  errorCode?: string;
  latencyMs: number;
  cacheHit: boolean;
  size: string;
}) {
  const payload = {
    requestId: metadata.requestId,
    success: metadata.success,
    errorCode: metadata.errorCode,
    endpointClass: "photos",
    costClass: "preferred",
    latencyMs: metadata.latencyMs,
    cacheHit: metadata.cacheHit,
    size: metadata.size,
  };

  // Structured log for metrics collection (safe metadata only).
  console.info("photo_proxy_metric", JSON.stringify(payload));
}

// Initialize Convex client for feature flag and gateway checks
let _convexClient: ConvexHttpClient | null = null;
function getConvexClient(): ConvexHttpClient {
  if (_convexClient) return _convexClient;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  }
  _convexClient = new ConvexHttpClient(url);
  return _convexClient;
}

// Validate size parameter
function isValidSize(size: string): size is PhotoSize {
  return size === "thumbnail" || size === "medium" || size === "full";
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const requestId = generateRequestId();
  const startTime = Date.now();
  const { placeId, photoRef } = await params;
  const searchParams = request.nextUrl.searchParams;
  const size = searchParams.get("size") || "medium";
  const exp = searchParams.get("exp");
  const sig = searchParams.get("sig");

  // Helper to emit metric and return response
  const finalize = (
    response: NextResponse,
    success: boolean,
    errorCode?: string
  ) => {
    emitPhotoMetric({
      requestId,
      success,
      errorCode,
      latencyMs: Date.now() - startTime,
      cacheHit: false,
      size,
    });
    return response;
  };

  // Validate size parameter
  if (!isValidSize(size)) {
    return finalize(
      new NextResponse("Invalid size parameter", { status: 400 }),
      false,
      "INVALID_SIZE"
    );
  }

  // In production, require valid signature
  if (process.env.NODE_ENV === "production") {
    if (!exp || !sig) {
      return finalize(
        new NextResponse("Missing signature parameters", { status: 403 }),
        false,
        "MISSING_SIGNATURE"
      );
    }

    const verification = verifySignature(placeId, photoRef, size, exp, sig);
    if (!verification.valid) {
      return finalize(
        new NextResponse(
          verification.reason === "expired"
            ? "URL has expired"
            : "Invalid signature",
          { status: 403 }
        ),
        false,
        verification.reason === "expired" ? "EXPIRED" : "INVALID_SIGNATURE"
      );
    }
  }

  const convex = getConvexClient();

  // Check circuit breaker state before making provider call
  try {
    const circuitState = await convex.query(api.providerGateway.getCircuitStatePublic, {
      service: "google_places",
    });

    if (circuitState === "open") {
      return finalize(
        new NextResponse(
          JSON.stringify({
            error: "Service temporarily unavailable",
            reason: "circuit_open",
          }),
          {
            status: 503,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              "Retry-After": "30",
            },
          }
        ),
        false,
        "CIRCUIT_OPEN"
      );
    }
  } catch (error) {
    // If we can't check circuit state, log and continue (fail open)
    console.error("Failed to check circuit breaker state:", error);
  }

  // Check feature flag (photos may be disabled for budget/degradation)
  try {
    // @ts-expect-error - TypeScript depth limit with complex Convex types
    const flag = await convex.query(api.providerGateway.checkFeatureFlag, {
      key: "photos_enabled",
    });

    if (!flag.enabled) {
      return finalize(
        new NextResponse(
          JSON.stringify({
            error: "Photos temporarily unavailable",
            reason: flag.reason || "service_degraded",
          }),
          {
            status: 503,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              "Retry-After": "300",
            },
          }
        ),
        false,
        "PHOTOS_DISABLED"
      );
    }
  } catch (error) {
    // If we can't check the flag, log and continue (fail open for photos)
    console.error("Failed to check photos_enabled flag:", error);
  }

  // Check budget before making the request
  try {
    const budget = await convex.query(api.providerGateway.checkBudgetPublic, {
      endpointClass: "photos",
    });

    if (!budget.allowed) {
      return finalize(
        new NextResponse(
          JSON.stringify({
            error: "Photos temporarily unavailable",
            reason: "budget_exceeded",
          }),
          {
            status: 503,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              "Retry-After": "3600", // Budget resets daily
            },
          }
        ),
        false,
        "BUDGET_EXCEEDED"
      );
    }
  } catch (error) {
    // If we can't check budget, log and continue (fail open)
    console.error("Failed to check photos budget:", error);
  }

  // Get API key
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error("GOOGLE_PLACES_API_KEY not configured");
    return finalize(
      new NextResponse("Service configuration error", { status: 500 }),
      false,
      "CONFIG_ERROR"
    );
  }

  // Build Google Photo URL
  const maxHeightPx = PHOTO_SIZE_MAP[size];
  const googlePhotoUrl = buildGooglePhotoUrl(placeId, photoRef, maxHeightPx, apiKey);

  // Track whether we successfully contacted the Google API
  // Used to determine if errors should affect circuit breaker
  let googleApiSucceeded = false;
  let photoUri: string | undefined;

  // Phase 1: Contact Google Places API to get photo URI
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const googleResponse = await fetch(googlePhotoUrl, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!googleResponse.ok) {
      // Log error without exposing details to client
      console.error(`Google Photos API error: ${googleResponse.status}`);

      // Record circuit breaker failure for server errors
      if (googleResponse.status >= 500 || googleResponse.status === 429) {
        try {
          await convex.mutation(api.providerGateway.recordCircuitFailurePublic, {
            service: "google_places",
          });
        } catch {
          // Ignore circuit breaker recording errors
        }
      }

      if (googleResponse.status === 404) {
        return finalize(
          new NextResponse("Photo not found", { status: 404 }),
          false,
          "NOT_FOUND"
        );
      }
      if (googleResponse.status === 429) {
        return finalize(
          new NextResponse("Rate limited", {
            status: 503,
            headers: { "Retry-After": "60" },
          }),
          false,
          "RATE_LIMITED"
        );
      }

      return finalize(
        new NextResponse("Failed to fetch photo", { status: 502 }),
        false,
        `HTTP_${googleResponse.status}`
      );
    }

    // Google Photos API with skipHttpRedirect returns JSON with photoUri
    const photoData = await googleResponse.json();
    photoUri = photoData.photoUri;

    if (!photoUri) {
      console.error("No photoUri in Google response");
      return finalize(
        new NextResponse("Invalid photo response", { status: 502 }),
        false,
        "INVALID_RESPONSE"
      );
    }

    // Mark Google API as successful
    googleApiSucceeded = true;

    // Record Google API success (we got a valid photoUri)
    try {
      await convex.mutation(api.providerGateway.recordCircuitSuccessPublic, {
        service: "google_places",
      });
    } catch (error) {
      console.error("Failed to record circuit success:", error);
    }
  } catch (error) {
    // Google API call failed - record circuit breaker failure
    try {
      await convex.mutation(api.providerGateway.recordCircuitFailurePublic, {
        service: "google_places",
      });
    } catch {
      // Ignore circuit breaker recording errors
    }

    if (error instanceof Error && error.name === "AbortError") {
      return finalize(
        new NextResponse("Request timeout", { status: 504 }),
        false,
        "TIMEOUT"
      );
    }

    console.error("Google API error:", error);
    return finalize(
      new NextResponse("Internal error", { status: 500 }),
      false,
      "INTERNAL_ERROR"
    );
  }

  // Phase 2: Fetch actual image from Google's CDN
  // This is a separate service, so errors here don't affect the Places API circuit breaker
  try {
    const imageResponse = await fetch(photoUri, {
      signal: AbortSignal.timeout(10000),
    });

    if (!imageResponse.ok) {
      return finalize(
        new NextResponse("Failed to fetch image", { status: 502 }),
        false,
        "IMAGE_FETCH_FAILED"
      );
    }

    // Record budget usage after successful photo delivery
    try {
      await convex.mutation(api.providerGateway.recordBudgetUsagePublic, {
        endpointClass: "photos",
        cost: 7,
      });
    } catch (error) {
      console.error("Failed to record budget usage:", error);
    }

    // Stream the image back with appropriate headers
    const contentType = imageResponse.headers.get("content-type") || "image/jpeg";

    const response = new NextResponse(imageResponse.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // Cache headers per policy - 15 min CDN, 5 min browser, stale-while-revalidate
        "Cache-Control": "public, s-maxage=900, max-age=300, stale-while-revalidate=60",
        // Security headers
        "X-Content-Type-Options": "nosniff",
        // Don't expose internal routing
        "X-Robots-Tag": "noindex",
      },
    });

    // Emit success metric
    emitPhotoMetric({
      requestId,
      success: true,
      latencyMs: Date.now() - startTime,
      cacheHit: false,
      size,
    });

    return response;
  } catch (error) {
    // CDN error - don't record circuit breaker failure since Google API succeeded
    if (error instanceof Error && error.name === "AbortError") {
      return finalize(
        new NextResponse("Image fetch timeout", { status: 504 }),
        false,
        "CDN_TIMEOUT"
      );
    }

    console.error("CDN fetch error:", error);
    return finalize(
      new NextResponse("Failed to fetch image", { status: 502 }),
      false,
      "CDN_ERROR"
    );
  }
}
