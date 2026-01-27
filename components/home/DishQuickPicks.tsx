"use client";

import Link from "next/link";

const DISHES = [
  { name: "Tagine", slug: "tagine", emoji: "🍲" },
  { name: "Couscous", slug: "couscous", emoji: "🥘" },
  { name: "Pastilla", slug: "pastilla", emoji: "🥧" },
  { name: "Seafood", slug: "seafood", emoji: "🦐" },
  { name: "Coffee", slug: "coffee", emoji: "☕" },
  { name: "Pastries", slug: "pastries", emoji: "🥐" },
];

export function DishQuickPicks() {
  return (
    <section className="mb-16">
      <h3 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        Popular Dishes
      </h3>
      <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
        {DISHES.map((dish) => (
          <Link
            key={dish.slug}
            href={`/search?dish=${dish.slug}`}
            className="group flex flex-col items-center rounded-xl border border-zinc-200 bg-white p-4 transition-all hover:border-orange-300 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-orange-600"
          >
            <span className="mb-2 text-3xl">{dish.emoji}</span>
            <span className="text-sm font-medium text-zinc-900 group-hover:text-orange-600 dark:text-zinc-100 dark:group-hover:text-orange-400">
              {dish.name}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
