"use client";

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { ReactNode, useMemo } from "react";

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error(
      "Missing NEXT_PUBLIC_CONVEX_URL. Set it in .env.local and restart the dev server."
    );
  }

  const client = useMemo(() => new ConvexReactClient(convexUrl), [convexUrl]);

  return <ConvexAuthProvider client={client}>{children}</ConvexAuthProvider>;
}
