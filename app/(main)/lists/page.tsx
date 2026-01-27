export const metadata = {
  title: "My Lists",
  description: "Your saved places and lists",
};

export default function ListsPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
          My Lists
        </h1>
        <p className="mt-4 text-zinc-600 dark:text-zinc-400">
          Lists functionality coming soon...
        </p>
      </div>
    </div>
  );
}
