import { notFound } from "next/navigation";

interface CuratedPlacePageProps {
  params: Promise<{
    slug: string;
  }>;
}

export async function generateMetadata({ params }: CuratedPlacePageProps) {
  const { slug } = await params;
  return {
    title: `${slug} - Curated Place`,
    description: `Discover ${slug} - a curated food spot in Morocco`,
  };
}

export default async function CuratedPlacePage({
  params,
}: CuratedPlacePageProps) {
  const { slug } = await params;

  if (!slug) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
          Curated Place
        </h1>
        <p className="mt-2 text-sm text-zinc-500">Slug: {slug}</p>
        <p className="mt-4 text-zinc-600 dark:text-zinc-400">
          Curated place details coming soon...
        </p>
      </div>
    </div>
  );
}
