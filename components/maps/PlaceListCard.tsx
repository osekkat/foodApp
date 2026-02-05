"use client";

import Link from "next/link";
import Image from "next/image";
import { MapPin, Star, Clock, Navigation } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, parsePlaceKey } from "@/lib/utils";

/**
 * Place data for sidebar display (like Yelp cards)
 */
export interface PlaceListItemData {
  /** Unique identifier */
  placeKey: string;
  /** Display name */
  name: string;
  /** Location coordinates */
  location: { lat: number; lng: number };
  /** Place type/category */
  placeType?: "restaurant" | "cafe" | "bakery" | "market" | "default";
  /** Provider rating (e.g., Google) */
  providerRating?: number;
  /** Provider review count */
  providerReviewCount?: number;
  /** Community rating (from our users) */
  communityRating?: number;
  /** Community review count */
  communityReviewCount?: number;
  /** Price level (e.g., "$", "$$", "$$$") */
  priceLevel?: string;
  /** Address or neighborhood */
  address?: string;
  /** Neighborhood */
  neighborhood?: string;
  /** Whether currently open */
  isOpen?: boolean;
  /** Opening hours text */
  hoursText?: string;
  /** Short description or tagline */
  description?: string;
  /** Category tags */
  tags?: string[];
  /** Whether this is a curated/featured place */
  isCurated?: boolean;
  /** Photo URL (or placeholder will be shown) */
  photoUrl?: string;
  /** Index number for display (1-based) */
  index?: number;
}

interface PlaceListCardProps {
  place: PlaceListItemData;
  /** Whether this card is currently selected/hovered */
  isSelected?: boolean;
  /** Whether this card is being hovered */
  isHovered?: boolean;
  /** Callback when card is clicked */
  onClick?: (placeKey: string) => void;
  /** Callback when mouse enters card */
  onMouseEnter?: (placeKey: string) => void;
  /** Callback when mouse leaves card */
  onMouseLeave?: () => void;
  /** Custom class name */
  className?: string;
}

/**
 * Get color based on place type
 */
const TYPE_COLORS: Record<string, string> = {
  restaurant: "bg-red-500",
  cafe: "bg-orange-500",
  bakery: "bg-yellow-500",
  market: "bg-green-500",
  default: "bg-blue-500",
};

/**
 * Format rating as stars display
 */
function RatingStars({ rating, count }: { rating: number; count?: number }) {
  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={cn(
              "h-3.5 w-3.5",
              star <= Math.round(rating)
                ? "fill-amber-400 text-amber-400"
                : "fill-zinc-200 text-zinc-200 dark:fill-zinc-600 dark:text-zinc-600"
            )}
          />
        ))}
      </div>
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {rating.toFixed(1)}
      </span>
      {count !== undefined && (
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          ({count.toLocaleString()} {count === 1 ? "review" : "reviews"})
        </span>
      )}
    </div>
  );
}

/**
 * PlaceListCard displays a place in the sidebar list (Yelp-style)
 *
 * Features:
 * - Photo carousel placeholder
 * - Rating display (provider + community)
 * - Open/closed status
 * - Category tags
 * - Hover highlighting synced with map
 * - Index number marker matching map
 */
export function PlaceListCard({
  place,
  isSelected = false,
  isHovered = false,
  onClick,
  onMouseEnter,
  onMouseLeave,
  className,
}: PlaceListCardProps) {
  const { provider, id } = parsePlaceKey(place.placeKey);
  const href = provider === "curated" ? `/place/c/${id}` : `/place/g/${id}`;
  const typeColor = TYPE_COLORS[place.placeType || "default"];

  const handleClick = (e: React.MouseEvent) => {
    if (onClick) {
      e.preventDefault();
      onClick(place.placeKey);
    }
  };

  return (
    <div
      className={cn(
        "group relative rounded-xl border bg-white transition-all dark:bg-zinc-900",
        isSelected || isHovered
          ? "border-orange-400 shadow-md ring-1 ring-orange-400/50 dark:border-orange-500 dark:ring-orange-500/50"
          : "border-zinc-200 hover:border-orange-300 hover:shadow-sm dark:border-zinc-700 dark:hover:border-orange-600",
        className
      )}
      onMouseEnter={() => onMouseEnter?.(place.placeKey)}
      onMouseLeave={onMouseLeave}
    >
      <Link href={href} onClick={handleClick} className="block">
        {/* Card content wrapper */}
        <div className="flex gap-4 p-4">
          {/* Left: Photo */}
          <div className="relative flex-shrink-0">
            <div className="relative h-24 w-24 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800 sm:h-28 sm:w-28">
              {place.photoUrl ? (
                <Image
                  src={place.photoUrl}
                  alt={place.name}
                  fill
                  sizes="(min-width: 640px) 112px, 96px"
                  className="object-cover"
                  unoptimized={place.photoUrl.startsWith("/api/photos/")}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <MapPin className="h-8 w-8 text-zinc-400" />
                </div>
              )}
            </div>
            {/* Index number badge */}
            {place.index !== undefined && (
              <div
                className={cn(
                  "absolute -left-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white shadow-md",
                  typeColor
                )}
              >
                {place.index}
              </div>
            )}
          </div>

          {/* Right: Content */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Header: Name + Curated badge */}
            <div className="flex items-start gap-2">
              <h3 className="flex-1 font-semibold text-zinc-900 group-hover:text-orange-600 dark:text-zinc-100 dark:group-hover:text-orange-400">
                {place.index !== undefined && (
                  <span className="mr-1 text-zinc-500 dark:text-zinc-400">
                    {place.index}.
                  </span>
                )}
                {place.name}
              </h3>
              {place.isCurated && (
                <Badge
                  variant="secondary"
                  className="flex-shrink-0 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                >
                  Featured
                </Badge>
              )}
            </div>

            {/* Rating */}
            {place.providerRating !== undefined && (
              <div className="mt-1">
                <RatingStars
                  rating={place.providerRating}
                  count={place.providerReviewCount}
                />
              </div>
            )}

            {/* Price + Category + Open status */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              {place.priceLevel && (
                <span className="font-medium text-zinc-600 dark:text-zinc-400">
                  {place.priceLevel}
                </span>
              )}
              {place.priceLevel && place.placeType && (
                <span className="text-zinc-300 dark:text-zinc-600">|</span>
              )}
              {place.placeType && place.placeType !== "default" && (
                <span className="capitalize text-zinc-600 dark:text-zinc-400">
                  {place.placeType}
                </span>
              )}
              {place.isOpen !== undefined && (
                <>
                  <span className="text-zinc-300 dark:text-zinc-600">|</span>
                  <span
                    className={cn(
                      "flex items-center gap-1 font-medium",
                      place.isOpen
                        ? "text-green-600 dark:text-green-500"
                        : "text-red-600 dark:text-red-500"
                    )}
                  >
                    <Clock className="h-3.5 w-3.5" />
                    {place.isOpen ? "Open" : "Closed"}
                  </span>
                </>
              )}
            </div>

            {/* Address/Neighborhood */}
            {(place.neighborhood || place.address) && (
              <p className="mt-1 truncate text-sm text-zinc-500 dark:text-zinc-400">
                {place.neighborhood || place.address}
              </p>
            )}

            {/* Description snippet */}
            {place.description && (
              <p className="mt-1.5 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
                &ldquo;{place.description}&rdquo;
              </p>
            )}

            {/* Tags */}
            {place.tags && place.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {place.tags.slice(0, 4).map((tag) => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="text-xs capitalize"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Action buttons row - only show if we have valid location */}
        {place.location.lat !== 0 && place.location.lng !== 0 && (
          <div className="flex items-center gap-2 border-t border-zinc-100 px-4 py-2 dark:border-zinc-800">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 flex-1 text-xs"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                // Open in Google Maps
                window.open(
                  `https://www.google.com/maps/dir/?api=1&destination=${place.location.lat},${place.location.lng}`,
                  "_blank"
                );
              }}
            >
              <Navigation className="mr-1.5 h-3.5 w-3.5" />
              Get Directions
            </Button>
          </div>
        )}
      </Link>
    </div>
  );
}

/**
 * Skeleton loading state for PlaceListCard
 */
export function PlaceListCardSkeleton() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex gap-4">
        {/* Photo skeleton */}
        <div className="h-24 w-24 flex-shrink-0 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700 sm:h-28 sm:w-28" />

        {/* Content skeleton */}
        <div className="flex flex-1 flex-col gap-2">
          <div className="h-5 w-3/4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="mt-auto flex gap-2">
            <div className="h-5 w-16 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-700" />
            <div className="h-5 w-16 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-700" />
          </div>
        </div>
      </div>
    </div>
  );
}
