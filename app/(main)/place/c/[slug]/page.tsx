import { notFound } from "next/navigation";
import { PlaceDetails } from "@/components/places";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

// Curated pages can be indexed (SEO-friendly)
// They contain only owned content

interface CuratedPlacePageProps {
  params: Promise<{
    slug: string;
  }>;
}

export async function generateMetadata({ params }: CuratedPlacePageProps) {
  const { slug } = await params;

  // Fetch curated place data for metadata
  try {
    const curatedPlace = await fetchQuery(api.curatedPlaces.getBySlug, { slug });

    if (curatedPlace) {
      return {
        title: `${curatedPlace.title} - Morocco Food Discovery`,
        description: curatedPlace.summary,
        openGraph: {
          title: curatedPlace.title,
          description: curatedPlace.summary,
          type: "website",
        },
      };
    }
  } catch {
    // Fall through to default
  }

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

  // Derive placeKey from slug
  const placeKey = `c:${slug}`;

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <PlaceDetails
          placeKey={placeKey}
          curatedSlug={slug}
        />
      </div>
    </div>
  );
}
