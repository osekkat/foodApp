import { NextRequest, NextResponse } from "next/server";

// Photo proxy for policy-compliant Google Places photo serving
// - Never persists photo bytes to DB/storage
// - Short TTL caching via CDN
// - API key never exposed to client
// - Must go through ProviderGateway for budgets/circuit breaker

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{
    placeId: string;
    photoRef: string;
  }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { placeId, photoRef } = await params;
  const searchParams = request.nextUrl.searchParams;
  const size = searchParams.get("size") || "medium";

  // TODO: Validate signed URL (exp + sig params) to prevent hotlinking
  // TODO: Implement ProviderGateway call for budget enforcement
  // TODO: Fetch from Google Places Photo API
  // TODO: Convert to WebP/AVIF for modern browsers
  // TODO: Apply image resizing based on size param

  // For now, return a placeholder response
  return NextResponse.json(
    {
      error: "Photo proxy not yet implemented",
      placeId,
      photoRef,
      size,
    },
    {
      status: 501,
      headers: {
        // Short TTL cache headers per policy
        "Cache-Control": "public, s-maxage=900, max-age=300, stale-while-revalidate=60",
      },
    }
  );
}
