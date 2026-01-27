import { notFound } from "next/navigation";
import { PlaceDetails } from "@/components/places";

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
    title: `Place Details`,
    description: `View details, reviews, and recommendations for this place`,
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

  // Derive placeKey from provider ID
  const placeKey = `g:${googlePlaceId}`;

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <PlaceDetails
          placeKey={placeKey}
          googlePlaceId={googlePlaceId}
        />
      </div>
    </div>
  );
}
