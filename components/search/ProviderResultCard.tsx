"use client";

import Link from "next/link";
import { MapPin, ChevronRight } from "lucide-react";
import type { AutocompleteResult } from "@/lib/searchSession";

export interface ProviderResultCardProps {
  suggestion: AutocompleteResult;
}

export function ProviderResultCard({ suggestion }: ProviderResultCardProps) {
  return (
    <Link
      href={`/place/g/${suggestion.placeId}`}
      className="flex items-start gap-3 p-3 rounded-lg border border-zinc-200 bg-white hover:border-orange-300 hover:shadow-sm transition-all dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-orange-600"
    >
      <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-700">
        <MapPin className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
          {suggestion.structuredFormat?.mainText.text || suggestion.text.text}
        </p>
        {suggestion.structuredFormat?.secondaryText && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate">
            {suggestion.structuredFormat.secondaryText.text}
          </p>
        )}
      </div>
      <ChevronRight className="h-5 w-5 text-zinc-400 flex-shrink-0 mt-2.5" />
    </Link>
  );
}
