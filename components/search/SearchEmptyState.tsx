"use client";

import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SearchEmptyStateProps {
  query: string;
  cityName?: string;
}

export function SearchEmptyState({ query, cityName }: SearchEmptyStateProps) {
  return (
    <div className="py-16 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
        <SearchX className="h-8 w-8 text-zinc-400" />
      </div>
      <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
        No results for &quot;{query}&quot;
      </h3>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400 max-w-sm mx-auto">
        {cityName
          ? `Try searching for different dishes or places in ${cityName}.`
          : "Try a different search term or explore our curated guides."}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/guides">
          <Button variant="outline">Browse Guides</Button>
        </Link>
        <Link href="/">
          <Button variant="outline">Explore Cities</Button>
        </Link>
      </div>
    </div>
  );
}
