"use client";

import { Badge } from "@/components/ui/badge";
import { MapPin, Star, Users } from "lucide-react";

interface PlaceHeaderProps {
  displayName: string;
  formattedAddress?: string;
  primaryType?: string;
  providerRating?: number;
  providerRatingCount?: number;
  communityRating?: number;
  communityRatingCount?: number;
  priceLevel?: string;
}

export function PlaceHeader({
  displayName,
  formattedAddress,
  primaryType,
  providerRating,
  providerRatingCount,
  communityRating,
  communityRatingCount,
  priceLevel,
}: PlaceHeaderProps) {
  // Convert priceLevel from API format (PRICE_LEVEL_MODERATE etc) to $ signs
  const getPriceSigns = (level?: string) => {
    if (!level) return null;
    const mapping: Record<string, string> = {
      PRICE_LEVEL_FREE: "Free",
      PRICE_LEVEL_INEXPENSIVE: "$",
      PRICE_LEVEL_MODERATE: "$$",
      PRICE_LEVEL_EXPENSIVE: "$$$",
      PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
    };
    return mapping[level] || null;
  };

  const price = getPriceSigns(priceLevel);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 sm:text-3xl">
            {displayName}
          </h1>
          {primaryType && (
            <p className="mt-1 text-sm text-zinc-500 capitalize">
              {primaryType.replace(/_/g, " ")}
            </p>
          )}
        </div>
        {price && (
          <Badge variant="outline" className="text-sm font-medium">
            {price}
          </Badge>
        )}
      </div>

      {formattedAddress && (
        <div className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{formattedAddress}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        {providerRating !== undefined && (
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 dark:bg-amber-900/30">
              <Star className="h-4 w-4 fill-amber-500 text-amber-500" />
              <span className="font-medium text-amber-700 dark:text-amber-400">
                {providerRating.toFixed(1)}
              </span>
            </div>
            {providerRatingCount !== undefined && providerRatingCount > 0 && (
              <span className="text-xs text-zinc-500">
                ({providerRatingCount.toLocaleString()} reviews)
              </span>
            )}
          </div>
        )}

        {communityRating !== undefined && communityRatingCount !== undefined && communityRatingCount > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 dark:bg-emerald-900/30">
              <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span className="font-medium text-emerald-700 dark:text-emerald-400">
                {communityRating.toFixed(1)}
              </span>
            </div>
            <span className="text-xs text-zinc-500">
              ({communityRatingCount} community)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
