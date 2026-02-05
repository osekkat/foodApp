"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import { ReactNode, useMemo, useSyncExternalStore } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

// Use useSyncExternalStore for hydration-safe mounting detection
const emptySubscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function AuthProvider({ children }: { children: ReactNode }) {
  const isMounted = useSyncExternalStore(
    emptySubscribe,
    getClientSnapshot,
    getServerSnapshot
  );
  const client = useMemo(
    () => (convexUrl ? new ConvexReactClient(convexUrl) : null),
    []
  );

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
