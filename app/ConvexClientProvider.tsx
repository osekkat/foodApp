"use client";

import { ReactNode } from "react";

import { AuthProvider } from "@/components/providers/AuthProvider";

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
