import Link from "next/link";

const CITIES = [
  { name: "Marrakech", slug: "marrakech", nameAr: "مراكش" },
  { name: "Casablanca", slug: "casablanca", nameAr: "الدار البيضاء" },
  { name: "Rabat", slug: "rabat", nameAr: "الرباط" },
  { name: "Tangier", slug: "tangier", nameAr: "طنجة" },
  { name: "Fes", slug: "fes", nameAr: "فاس" },
];

const DISHES = [
  { name: "Tagine", slug: "tagine", emoji: "🍲" },
  { name: "Couscous", slug: "couscous", emoji: "🥘" },
  { name: "Pastilla", slug: "pastilla", emoji: "🥧" },
  { name: "Seafood", slug: "seafood", emoji: "🦐" },
  { name: "Coffee", slug: "coffee", emoji: "☕" },
  { name: "Pastries", slug: "pastries", emoji: "🥐" },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 to-white dark:from-zinc-900 dark:to-black">
      <header className="border-b border-orange-100 dark:border-zinc-800">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-orange-600 dark:text-orange-400">
              Morocco Eats
            </h1>
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
        {/* Hero Section */}
        <section className="mb-16 text-center">
          <h2 className="mb-4 text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 sm:text-5xl">
            Discover Morocco&apos;s Best Food
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
            From traditional tagine to fresh seafood, find the best restaurants
            and hidden gems across Morocco&apos;s vibrant cities.
          </p>

          {/* Search Bar */}
          <div className="mt-8 flex justify-center">
            <div className="relative w-full max-w-xl">
              <input
                type="text"
                placeholder="Search for restaurants, dishes, or places..."
                className="w-full rounded-full border border-zinc-200 bg-white px-6 py-4 pr-12 text-lg shadow-sm placeholder:text-zinc-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
              />
              <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-orange-600 p-3 text-white hover:bg-orange-700">
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </button>
            </div>
          </div>
        </section>

        {/* City Quick Picks */}
        <section className="mb-16">
          <h3 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Explore by City
          </h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {CITIES.map((city) => (
              <Link
                key={city.slug}
                href={`/search?city=${city.slug}`}
                className="group flex flex-col items-center rounded-xl border border-zinc-200 bg-white p-6 transition-all hover:border-orange-300 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-orange-600"
              >
                <span className="text-lg font-medium text-zinc-900 group-hover:text-orange-600 dark:text-zinc-100 dark:group-hover:text-orange-400">
                  {city.name}
                </span>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {city.nameAr}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Dish Quick Picks */}
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

        {/* Near Me Quick Action */}
        <section className="mb-16 text-center">
          <button className="inline-flex items-center gap-2 rounded-full border-2 border-orange-600 px-8 py-4 text-lg font-medium text-orange-600 transition-colors hover:bg-orange-600 hover:text-white dark:border-orange-500 dark:text-orange-400 dark:hover:bg-orange-500 dark:hover:text-white">
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            Find Food Near Me
          </button>
        </section>

        {/* Featured Guides Placeholder */}
        <section>
          <h3 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Curated Guides
          </h3>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {["Best Tagine in Marrakech", "Top Cafes in Casablanca", "Seafood Gems in Tangier"].map(
              (guide) => (
                <div
                  key={guide}
                  className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800"
                >
                  <div className="mb-4 h-32 rounded-lg bg-zinc-100 dark:bg-zinc-700" />
                  <h4 className="font-medium text-zinc-900 dark:text-zinc-100">
                    {guide}
                  </h4>
                  <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                    Coming soon...
                  </p>
                </div>
              )
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 py-8 dark:border-zinc-800">
        <div className="mx-auto max-w-7xl px-4 text-center text-sm text-zinc-500 dark:text-zinc-400 sm:px-6 lg:px-8">
          <p>&copy; 2026 Morocco Eats. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
