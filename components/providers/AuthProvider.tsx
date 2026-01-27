"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import { ReactNode, useEffect, useMemo, useState } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isMounted, setIsMounted] = useState(false);
  const client = useMemo(
    () => (convexUrl ? new ConvexReactClient(convexUrl) : null),
    []
  );

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // During SSR/static generation, render children without auth context
  if (!isMounted || !client) {
    return <>{children}</>;
  }

  return (
    <ConvexAuthNextjsProvider client={client}>
      {children}
    </ConvexAuthNextjsProvider>
  );
}
