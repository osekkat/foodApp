/**
 * Field Sets Registry - Approved FieldMask configurations for Google Places API (New)
 *
 * Policy: Only these pre-approved field sets can be used. No ad-hoc field masks.
 * Each field set maps to a specific use case and cost tier.
 *
 * Google Places API (New) uses FieldMask to control which fields are returned.
 * Different fields have different pricing tiers:
 * - Basic: id, displayName, formattedAddress, etc.
 * - Advanced: regularOpeningHours, priceLevel, etc.
 * - Preferred: reviews, photos (high cost)
 */

/**
 * Cost tiers for Google Places API (New)
 * Used for budget tracking and cost allocation
 */
export type CostTier = "basic" | "advanced" | "preferred";

/**
 * Field set definition with metadata
 */
export interface FieldSetDefinition {
  mask: string;
  costTier: CostTier;
  description: string;
  maxCostPerCall: number; // Estimated cost in millicents
}

/**
 * Approved field sets - all provider requests must use one of these
 */
export const FIELD_SETS = {
  /**
   * Health check - minimal fields for testing connectivity
   * Use case: Circuit breaker health probes
   */
  HEALTH_CHECK: {
    mask: "id",
    costTier: "basic" as CostTier,
    description: "Minimal fields for health check",
    maxCostPerCall: 1, // Very low cost
  },

  /**
   * Search lite - minimal fields for search results list
   * Use case: Autocomplete results, search result cards
   */
  SEARCH_LITE: {
    mask: "places.id,places.displayName,places.formattedAddress,places.location",
    costTier: "basic" as CostTier,
    description: "Minimal fields for search result cards",
    maxCostPerCall: 3,
  },

  /**
   * Place header - fields for place card/preview
   * Use case: Map markers, place cards in lists
   */
  PLACE_HEADER: {
    mask: "id,displayName,formattedAddress,location,primaryType,primaryTypeDisplayName",
    costTier: "basic" as CostTier,
    description: "Basic place identification and location",
    maxCostPerCall: 5,
  },

  /**
   * Place details standard - common use case for place page
   * Use case: Place detail page (without photos/reviews from provider)
   */
  PLACE_DETAILS_STANDARD: {
    mask: [
      "id",
      "displayName",
      "formattedAddress",
      "location",
      "primaryType",
      "primaryTypeDisplayName",
      "nationalPhoneNumber",
      "internationalPhoneNumber",
      "websiteUri",
      "googleMapsUri",
      "regularOpeningHours",
      "utcOffsetMinutes",
      "rating",
      "userRatingCount",
      "priceLevel",
    ].join(","),
    costTier: "advanced" as CostTier,
    description: "Standard place details for place page",
    maxCostPerCall: 17,
  },

  /**
   * Place details with photos - includes photo references
   * Use case: Place detail page with photos
   */
  PLACE_DETAILS_WITH_PHOTOS: {
    mask: [
      "id",
      "displayName",
      "formattedAddress",
      "location",
      "primaryType",
      "primaryTypeDisplayName",
      "nationalPhoneNumber",
      "internationalPhoneNumber",
      "websiteUri",
      "googleMapsUri",
      "regularOpeningHours",
      "utcOffsetMinutes",
      "rating",
      "userRatingCount",
      "priceLevel",
      "photos",
    ].join(","),
    costTier: "preferred" as CostTier,
    description: "Place details with photo references",
    maxCostPerCall: 25,
  },

  /**
   * Nearby search - for map viewport searches
   * Use case: "Search this area" on map
   */
  NEARBY_SEARCH: {
    mask: "places.id,places.displayName,places.location,places.primaryType",
    costTier: "basic" as CostTier,
    description: "Minimal fields for map markers",
    maxCostPerCall: 3,
  },

  /**
   * Text search - for query-based searches
   * Use case: Search bar queries
   * Includes photos for search result cards
   */
  TEXT_SEARCH: {
    mask: "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.primaryType,places.photos",
    costTier: "preferred" as CostTier,
    description: "Search results with ratings and photos",
    maxCostPerCall: 17,
  },

  /**
   * Autocomplete - for search suggestions
   * Use case: Search bar autocomplete dropdown
   * Note: Autocomplete API has special pricing when used with session tokens
   */
  AUTOCOMPLETE: {
    mask: "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types",
    costTier: "basic" as CostTier,
    description: "Autocomplete suggestions with place ID and display text",
    maxCostPerCall: 3, // Session-tokened pricing is bundled
  },
} as const;

export type FieldSetKey = keyof typeof FIELD_SETS;

/**
 * Get field mask string for a field set key
 */
export function getFieldMask(key: FieldSetKey): string {
  return FIELD_SETS[key].mask;
}

/**
 * Get cost tier for a field set key
 */
export function getCostTier(key: FieldSetKey): CostTier {
  return FIELD_SETS[key].costTier;
}

/**
 * Get estimated max cost for a field set key (in millicents)
 */
export function getMaxCost(key: FieldSetKey): number {
  return FIELD_SETS[key].maxCostPerCall;
}

/**
 * Endpoint classes for budget allocation
 */
export const ENDPOINT_CLASSES = {
  HEALTH: "health",
  AUTOCOMPLETE: "autocomplete",
  TEXT_SEARCH: "text_search",
  NEARBY_SEARCH: "nearby_search",
  PLACE_DETAILS: "place_details",
  PHOTOS: "photos",
} as const;

export type EndpointClass = (typeof ENDPOINT_CLASSES)[keyof typeof ENDPOINT_CLASSES];

/**
 * Budget limits per endpoint class per day (in millicents)
 * These are conservative defaults - adjust based on actual usage
 */
export const DAILY_BUDGET_LIMITS: Record<EndpointClass, number> = {
  health: 100, // Health checks are cheap
  autocomplete: 5000, // Session-tokened, relatively cheap
  text_search: 10000, // Main search, moderate cost
  nearby_search: 8000, // Map searches
  place_details: 15000, // Most expensive per call
  photos: 5000, // Photo fetches
};
