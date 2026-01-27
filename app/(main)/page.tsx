import Link from "next/link";
import {
  SearchHero,
  CityPicker,
  DishQuickPicks,
  NearMeCard,
  FeaturedPlaces,
  FeaturedGuides,
} from "@/components/home";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white dark:from-zinc-900 dark:to-black">
      <header className="border-b border-orange-100 dark:border-zinc-800">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-2xl font-bold text-orange-600 dark:text-orange-400">
              Morocco Eats
            </Link>
            <nav className="flex items-center gap-4">
              <Link
                href="/search"
                className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Search
              </Link>
              <Link
                href="/map"
                className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Map
              </Link>
              <Link
                href="/signin"
                className="rounded-full bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
              >
                Sign In
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <SearchHero />
        <CityPicker />
        <DishQuickPicks />
        <NearMeCard />
        <FeaturedGuides city="marrakech" locale="en" />
        <FeaturedPlaces city="marrakech" />
      </main>

      <footer className="border-t border-zinc-200 py-8 dark:border-zinc-800">
        <div className="mx-auto max-w-7xl px-4 text-center text-sm text-zinc-500 dark:text-zinc-400 sm:px-6 lg:px-8">
          <p>&copy; 2026 Morocco Eats. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
