import { notFound } from "next/navigation";

// Provider-backed pages must be dynamic (no-store)
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PlaceDetailPageProps {
  params: Promise<{
    googlePlaceId: string;
  }>;
}

export async function generateMetadata({ params }: PlaceDetailPageProps) {
  const { googlePlaceId } = await params;
  return {
    title: `Place ${googlePlaceId}`,
    robots: { index: false, follow: false }, // noindex for provider-backed pages
  };
}

export default async function GooglePlaceDetailPage({
  params,
}: PlaceDetailPageProps) {
  const { googlePlaceId } = await params;

  if (!googlePlaceId) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
          Place Details
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Provider Place ID: {googlePlaceId}
        </p>
        <p className="mt-4 text-zinc-600 dark:text-zinc-400">
          Place details page coming soon...
        </p>
      </div>
    </div>
  );
}
