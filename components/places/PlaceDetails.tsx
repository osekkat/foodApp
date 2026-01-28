"use client";

import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useEffect, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, ExternalLink } from "lucide-react";
import { PlaceHeader } from "./PlaceHeader";
import { PlaceActions } from "./PlaceActions";
import { PlaceHours } from "./PlaceHours";
import { TasteTags } from "./TasteTags";
import { ReviewCard } from "./ReviewCard";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";

interface ProviderPlaceData {
  id: string;
  displayName?: { text: string; languageCode: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  primaryType?: string;
  primaryTypeDisplayName?: { text: string };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  regularOpeningHours?: {
    openNow?: boolean;
    periods?: Array<{
      open: { day: number; hour: number; minute: number };
      close?: { day: number; hour: number; minute: number };
    }>;
    weekdayDescriptions?: string[];
  };
  utcOffsetMinutes?: number;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  photos?: Array<{
    name: string;
    widthPx: number;
    heightPx: number;
  }>;
}

interface PlaceDetailsProps {
  placeKey: string;
  googlePlaceId?: string;
  curatedSlug?: string;
}

export function PlaceDetails({
  placeKey,
  googlePlaceId,
  curatedSlug,
}: PlaceDetailsProps) {
  const [providerData, setProviderData] = useState<ProviderPlaceData | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providerLoading, setProviderLoading] = useState(false);
  const photosEnabled = useFeatureFlag("photos_enabled");
  const providerMatches = !!googlePlaceId && providerData?.id === googlePlaceId;
  const activeProviderData = providerMatches ? providerData : null;
  const requestIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  // Fetch owned data from Convex
  const communityData = useQuery(api.placeDetails.getPlaceCommunityData, {
    placeKey,
  });
  const userStatus = useQuery(api.placeDetails.getUserPlaceStatus, { placeKey });
  const curatedOverlay = useQuery(api.placeDetails.getCuratedOverlay, { placeKey });
  const reviewsData = useQuery(api.placeDetails.getPlaceReviews, {
    placeKey,
    limit: 5,
  });

  // For curated places, get the curated place data directly
  const curatedPlace = useQuery(
    api.curatedPlaces.getBySlug,
    curatedSlug ? { slug: curatedSlug } : "skip"
  );

  // Action to fetch provider data
  const fetchProviderDetails = useAction(api.placeDetails.fetchProviderDetails);

  // Reset provider state when switching places
  useEffect(() => {
    requestIdRef.current += 1;
    inFlightRef.current = false;
    setProviderData(null);
    setProviderError(null);
    setProviderLoading(false);
  }, [googlePlaceId]);

  // Track mounted state to avoid setState after unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Fetch provider data on mount (only for provider places)
  useEffect(() => {
    if (googlePlaceId && !providerMatches && !providerError && !inFlightRef.current) {
      const requestId = ++requestIdRef.current;
      inFlightRef.current = true;
      setProviderLoading(true);

      fetchProviderDetails({
        googlePlaceId,
        includePhotos: photosEnabled,
      })
        .then((result) => {
          if (!mountedRef.current || requestIdRef.current !== requestId) return;
          if (result.success && result.data) {
            setProviderError(null);
            setProviderData(result.data);
          } else {
            setProviderError(result.error?.message || "Failed to load place details");
          }
        })
        .catch((err) => {
          if (!mountedRef.current || requestIdRef.current !== requestId) return;
          setProviderError(err.message || "Failed to load place details");
        })
        .finally(() => {
          if (!mountedRef.current || requestIdRef.current !== requestId) return;
          inFlightRef.current = false;
          setProviderLoading(false);
        });
    }
  }, [googlePlaceId, providerMatches, providerError, fetchProviderDetails, photosEnabled]);

  // Derive display data from provider or curated
  const displayName =
    activeProviderData?.displayName?.text ||
    curatedPlace?.title ||
    curatedOverlay?.title ||
    "Loading...";

  const formattedAddress =
    activeProviderData?.formattedAddress ||
    (curatedPlace
      ? [curatedPlace.neighborhood, curatedPlace.city].filter(Boolean).join(", ")
      : "");

  const primaryType =
    activeProviderData?.primaryType || curatedPlace?.tags?.[0] || "";

  const handleToggleFavorite = async () => {
    // TODO: Implement favorite toggle mutation
    console.log("Toggle favorite for", placeKey);
  };

  const handleVoteTag = async (tag: string, vote: "up" | "down") => {
    // TODO: Implement tag voting mutation
    console.log("Vote", vote, "on tag", tag, "for", placeKey);
  };

  const handleMarkHelpful = async (reviewId: string) => {
    // TODO: Implement helpful vote mutation
    console.log("Mark helpful", reviewId);
  };

  // Loading state
  if (providerLoading && googlePlaceId) {
    return <PlaceDetailsSkeleton />;
  }

  // Error state for provider places
  if (providerError && googlePlaceId) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950">
        <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
          <AlertCircle className="h-5 w-5" />
          <span className="font-medium">Unable to load place details</span>
        </div>
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">
          {providerError}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => {
            setProviderError(null);
            setProviderLoading(false);
            setProviderData(null);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PlaceHeader
        displayName={displayName}
        formattedAddress={formattedAddress}
        primaryType={primaryType}
        providerRating={activeProviderData?.rating}
        providerRatingCount={activeProviderData?.userRatingCount}
        communityRating={communityData?.stats.communityRatingAvg}
        communityRatingCount={communityData?.stats.communityRatingCount}
        priceLevel={activeProviderData?.priceLevel}
      />

      {/* Actions */}
      <PlaceActions
        placeKey={placeKey}
        phoneNumber={activeProviderData?.nationalPhoneNumber}
        websiteUri={activeProviderData?.websiteUri}
        googleMapsUri={activeProviderData?.googleMapsUri}
        location={activeProviderData?.location}
        hasFavorited={userStatus?.hasFavorited || false}
        isAuthenticated={userStatus?.isAuthenticated || false}
        onToggleFavorite={handleToggleFavorite}
      />

      <Separator />

      {/* Opening Hours */}
      {activeProviderData?.regularOpeningHours && (
        <>
          <PlaceHours
            openNow={activeProviderData.regularOpeningHours.openNow}
            weekdayDescriptions={activeProviderData.regularOpeningHours.weekdayDescriptions}
          />
          <Separator />
        </>
      )}

      {/* Curated Card Overlay (Editorial Tips) */}
      {(curatedOverlay || curatedPlace) && (
        <Card className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-emerald-800 dark:text-emerald-300">
              Editor&apos;s Tips
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              {curatedOverlay?.summary || curatedPlace?.summary}
            </p>
            {(curatedOverlay?.mustTry || curatedPlace?.mustTry) && (
              <div>
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  Must try:{" "}
                </span>
                <span className="text-sm text-zinc-700 dark:text-zinc-300">
                  {(curatedOverlay?.mustTry || curatedPlace?.mustTry)?.join(", ")}
                </span>
              </div>
            )}
            {(curatedOverlay?.priceNote || curatedPlace?.priceNote) && (
              <div>
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  Price:{" "}
                </span>
                <span className="text-sm text-zinc-700 dark:text-zinc-300">
                  {curatedOverlay?.priceNote || curatedPlace?.priceNote}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Website Link */}
      {activeProviderData?.websiteUri && (
        <a
          href={activeProviderData.websiteUri}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          Visit website
          <ExternalLink className="h-3 w-3" />
        </a>
      )}

      {/* Taste Tags & Dishes */}
      {communityData && (
        <TasteTags
          tags={communityData.topTags}
          dishes={communityData.topDishes}
          onVote={handleVoteTag}
          isAuthenticated={userStatus?.isAuthenticated}
        />
      )}

      <Separator />

      {/* Reviews Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Reviews
            {communityData && communityData.reviewCount > 0 && (
              <span className="ml-2 text-sm font-normal text-zinc-500">
                ({communityData.reviewCount})
              </span>
            )}
          </h2>
          {userStatus?.isAuthenticated && !userStatus?.hasReviewed && (
            <Button size="sm">Write a Review</Button>
          )}
        </div>

        {reviewsData?.reviews && reviewsData.reviews.length > 0 ? (
          <div>
            {reviewsData.reviews.map((review) => (
              <ReviewCard
                key={review._id}
                review={review}
                onMarkHelpful={handleMarkHelpful}
                isAuthenticated={userStatus?.isAuthenticated}
              />
            ))}
            {reviewsData.hasMore && (
              <Button variant="outline" className="mt-4 w-full">
                Load more reviews
              </Button>
            )}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-zinc-500">
            No reviews yet. Be the first to share your experience!
          </p>
        )}
      </div>
    </div>
  );
}

function PlaceDetailsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-16" />
        <Skeleton className="h-9 w-16" />
      </div>
      <Separator />
      <Skeleton className="h-20 w-full" />
      <Separator />
      <div className="space-y-4">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}
