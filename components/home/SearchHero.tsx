"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

export function SearchHero() {
  const [query, setQuery] = useState("");
  const router = useRouter();

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (query.trim()) {
        router.push(`/search?q=${encodeURIComponent(query.trim())}`);
      } else {
        router.push("/search");
      }
    },
    [query, router]
  );

  return (
    <section className="mb-16 text-center">
      <h2 className="mb-4 text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-5xl">
        Discover Morocco&apos;s Best Food
      </h2>
      <p className="mx-auto max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
        From traditional tagine to fresh seafood, find the best restaurants and hidden gems across
        Morocco&apos;s vibrant cities.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 flex justify-center">
        <div className="relative w-full max-w-xl">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for restaurants, dishes, or places..."
            className="w-full rounded-full border border-zinc-200 bg-white px-6 py-4 pe-12 text-lg shadow-sm placeholder:text-zinc-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
          />
          <button
            type="submit"
            className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full bg-orange-600 p-3 text-white hover:bg-orange-700 transition-colors"
          >
            <Search className="size-5" />
          </button>
        </div>
      </form>
    </section>
  );
}
