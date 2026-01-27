"use client";

// TODO: Switch back to ConvexAuthNextjsProvider once auth is configured
// import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

// Defensive check for build time when env vars may not be available
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!convex) {
    // During SSR/build without env vars, render children directly
    return <>{children}</>;
  }
  // Using ConvexProvider until ConvexAuth is configured (needs GOOGLE_CLIENT_ID/SECRET)
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
