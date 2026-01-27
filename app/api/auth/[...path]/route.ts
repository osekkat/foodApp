import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function proxyAuthRequest(request: NextRequest) {
  const convexSiteUrl =
    process.env.CONVEX_SITE_URL ??
    process.env.NEXT_PUBLIC_CONVEX_URL?.replace(
      ".convex.cloud",
      ".convex.site"
    );
  if (!convexSiteUrl) {
    return new Response("Missing CONVEX_SITE_URL", { status: 500 });
  }

  const incomingUrl = new URL(request.url);
  const targetBase = new URL(convexSiteUrl);
  const targetUrl = new URL(incomingUrl.pathname + incomingUrl.search, targetBase);

  const headers = new Headers(request.headers);
  headers.delete("host");

  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();

  return fetch(targetUrl, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
  });
}

export async function GET(request: NextRequest) {
  return proxyAuthRequest(request);
}

export async function POST(request: NextRequest) {
  return proxyAuthRequest(request);
}

export async function HEAD(request: NextRequest) {
  return proxyAuthRequest(request);
}
