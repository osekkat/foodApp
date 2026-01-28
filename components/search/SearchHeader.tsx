"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export interface SearchHeaderProps {
  cityName?: string;
  cityNameAr?: string;
}

export function SearchHeader({ cityName, cityNameAr }: SearchHeaderProps) {
  return (
    <div className="border-b border-zinc-200 bg-gradient-to-br from-orange-50 to-white dark:border-zinc-800 dark:from-zinc-900 dark:to-black">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Home
        </Link>
        <h1 className="mt-4 text-2xl font-bold text-zinc-900 dark:text-zinc-100 sm:text-3xl">
          {cityName ? `Explore ${cityName}` : "Search"}
        </h1>
        {cityNameAr && (
          <p className="mt-1 text-lg text-zinc-500 dark:text-zinc-400">
            {cityNameAr}
          </p>
        )}
      </div>
    </div>
  );
}
