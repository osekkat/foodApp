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
 * - Budget tracking through ProviderGateway patterns
 */

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{
    placeId: string;
    photoRef: string;
  }>;
}

// Initialize Convex client for feature flag checks
function getConvexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  }
  return new ConvexHttpClient(url);
}

// Validate size parameter
function isValidSize(size: string): size is PhotoSize {
  return size === "thumbnail" || size === "medium" || size === "full";
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { placeId, photoRef } = await params;
  const searchParams = request.nextUrl.searchParams;
  const size = searchParams.get("size") || "medium";
  const exp = searchParams.get("exp");
  const sig = searchParams.get("sig");

  // Validate size parameter
  if (!isValidSize(size)) {
    return new NextResponse("Invalid size parameter", { status: 400 });
  }

  // In production, require valid signature
  if (process.env.NODE_ENV === "production") {
    if (!exp || !sig) {
      return new NextResponse("Missing signature parameters", { status: 403 });
    }

    const verification = verifySignature(placeId, photoRef, size, exp, sig);
    if (!verification.valid) {
      return new NextResponse(
        verification.reason === "expired"
          ? "URL has expired"
          : "Invalid signature",
        { status: 403 }
      );
    }
  }

  // Check feature flag (photos may be disabled for budget/degradation)
  try {
    const convex = getConvexClient();
    // @ts-expect-error - TypeScript depth limit with complex Convex types
    const flag = await convex.query(api.providerGateway.checkFeatureFlag, {
      key: "photos_enabled",
    });

    if (!flag.enabled) {
      return new NextResponse(
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
      );
    }
  } catch (error) {
    // If we can't check the flag, log and continue (fail open for photos)
    console.error("Failed to check photos_enabled flag:", error);
  }

  // Get API key
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error("GOOGLE_PLACES_API_KEY not configured");
    return new NextResponse("Service configuration error", { status: 500 });
  }

  // Build Google Photo URL
  const maxHeightPx = PHOTO_SIZE_MAP[size];
  const googlePhotoUrl = buildGooglePhotoUrl(placeId, photoRef, maxHeightPx, apiKey);

  try {
    // Fetch from Google with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const googleResponse = await fetch(googlePhotoUrl, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!googleResponse.ok) {
      // Log error without exposing details to client
      console.error(`Google Photos API error: ${googleResponse.status}`);

      if (googleResponse.status === 404) {
        return new NextResponse("Photo not found", { status: 404 });
      }
      if (googleResponse.status === 429) {
        return new NextResponse("Rate limited", {
          status: 503,
          headers: { "Retry-After": "60" },
        });
      }

      return new NextResponse("Failed to fetch photo", { status: 502 });
    }

    // Google Photos API with skipHttpRedirect returns JSON with photoUri
    const photoData = await googleResponse.json();
    const photoUri = photoData.photoUri;

    if (!photoUri) {
      console.error("No photoUri in Google response");
      return new NextResponse("Invalid photo response", { status: 502 });
    }

    // Fetch the actual image
    const imageResponse = await fetch(photoUri, {
      signal: AbortSignal.timeout(10000),
    });

    if (!imageResponse.ok) {
      return new NextResponse("Failed to fetch image", { status: 502 });
    }

    // Stream the image back with appropriate headers
    const contentType = imageResponse.headers.get("content-type") || "image/jpeg";

    return new NextResponse(imageResponse.body, {
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
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return new NextResponse("Request timeout", { status: 504 });
    }

    console.error("Photo proxy error:", error);
    return new NextResponse("Internal error", { status: 500 });
  }
}
