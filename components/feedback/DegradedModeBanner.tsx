"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, X } from "lucide-react";
import type { ServiceModeState } from "@/convex/serviceMode";

interface DegradedModeBannerProps {
  mode: ServiceModeState;
}

function getMessage(mode: ServiceModeState): string {
  if (mode.currentMode === 3) {
    return "You're offline. Showing owned content only.";
  }
  return "Some features are limited right now.";
}

export function DegradedModeBanner({ mode }: DegradedModeBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
  }, [mode.currentMode]);

  if (dismissed) return null;

  return (
    <div className="sticky top-0 z-40 w-full border-b border-amber-200 bg-amber-50/95 text-amber-900 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-start justify-between gap-4 px-4 py-2 text-sm sm:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-700" />
          <span>{getMessage(mode)}</span>
          <Link href="/guides" className="font-medium underline underline-offset-2">
            Browse guides
          </Link>
          <span className="text-amber-700/80">or</span>
          <Link href="/lists" className="font-medium underline underline-offset-2">
            view saved places
          </Link>
          <span className="text-amber-700/80">or</span>
          <Link href="/lists" className="font-medium underline underline-offset-2">
            explore lists
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded p-1 text-amber-800 transition hover:bg-amber-100"
          aria-label="Dismiss service mode banner"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
