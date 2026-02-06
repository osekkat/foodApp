import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";
import { generateSignedPhotoUrl } from "../lib/photoUrls";

type TextSearchPlace = {
  placeKey: string;
  placeId: string;
  displayName: string;
  location: { lat: number; lng: number };
  primaryType?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  formattedAddress?: string;
  photoUrl?: string;
};

type RawProviderPhoto = {
  name?: string;
};

type RawTextSearchProviderPlace = {
  id?: string;
  name?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  formattedAddress?: string;
  photos?: RawProviderPhoto[];
};

/**
 * Places queries and mutations
 *
 * Policy Reminders:
 * - NEVER persist provider content (name/address/phone/hours/ratings/photos)
 * - ONLY persist: placeKey, lat/lng (with expiry), community aggregates
 */

// Autocomplete action calling provider gateway
export const autocomplete = action({
  args: {
    input: v.string(),
    sessionToken: v.optional(v.string()),
    locationBias: v.optional(
      v.object({
        lat: v.number(),
        lng: v.number(),
        radiusMeters: v.optional(v.number()),
      }),
    ),
    language: v.optional(v.string()),
    includedPrimaryTypes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<unknown> => {
    // Work around TypeScript depth limitations with complex Convex types
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const internal: any = require("./_generated/api").internal;
    return await ctx.runAction(internal.providerGateway.providerRequest, {
      endpointClass: "autocomplete",
      fieldSet: "AUTOCOMPLETE",
      input: args.input,
      sessionToken: args.sessionToken,
      locationBias: args.locationBias,
      language: args.language,
      includedPrimaryTypes: args.includedPrimaryTypes,
    });
  },
});

// Text search action for "Search this area" on map
export const textSearch = action({
  args: {
    query: v.string(),
    locationRestriction: v.optional(
      v.object({
        north: v.number(),
        south: v.number(),
        east: v.number(),
        west: v.number(),
      }),
    ),
    locationBias: v.optional(
      v.object({
        lat: v.number(),
        lng: v.number(),
        radiusMeters: v.optional(v.number()),
      }),
    ),
    language: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: boolean;
    places: TextSearchPlace[];
    error?: string;
  }> => {
    // Work around TypeScript depth limitations with complex Convex types
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const internal: any = require("./_generated/api").internal;

    const result = await ctx.runAction(
      internal.providerGateway.providerRequest,
      {
        endpointClass: "text_search",
        fieldSet: "TEXT_SEARCH",
        query: args.query,
        // Map/list UI requires full provider fields, not ID-only cache rows.
        allowIdOnlySearchCacheResponse: false,
        locationRestriction: args.locationRestriction,
        locationBias: args.locationBias,
        language: args.language ?? "en",
      },
    );

    if (!result.success) {
      return {
        success: false,
        places: [],
        error: result.error?.message ?? "Search failed",
      };
    }

    // Extract places from the response
    const data = result.data as { places?: RawTextSearchProviderPlace[] } | undefined;
    const rawPlaces = data?.places ?? [];

    // Transform to our format, filtering out places with no usable data
    const allPlaces: Array<TextSearchPlace | null> = await Promise.all(
      rawPlaces.map(async (place): Promise<TextSearchPlace | null> => {
        const placeId = place.id ?? place.name?.split("/").pop() ?? "";
        const displayName = place.displayName?.text;

        // Skip places with no ID or no display name -- these are unusable results
        if (!placeId || !displayName) {
          return null;
        }

        // Extract first photo reference (policy-safe: we only store the reference, not the photo)
        // Google Places API (New) returns photos as: { name: "places/{placeId}/photos/{photoRef}", ... }
        // Prefer signed proxy URLs. If signing is unavailable in the current runtime,
        // fall back to unsigned proxy URLs (useful for local/dev workflows).
        let photoUrl: string | undefined;
        if (place.photos && place.photos.length > 0) {
          const photoName = place.photos[0]?.name;
          if (photoName) {
            const parts = photoName.split("/photos/");
            if (parts.length === 2) {
              const photoReference = parts[1];
              try {
                photoUrl = await generateSignedPhotoUrl(
                  placeId,
                  photoReference,
                  "medium",
                );
              } catch {
                // Fallback when signing is unavailable in this runtime.
                // Useful for local/dev and prevents dropping photos from search cards.
                photoUrl = `/api/photos/${encodeURIComponent(placeId)}/${encodeURIComponent(photoReference)}?size=medium`;
              }
            }
          }
        }

        return {
          placeKey: `g:${placeId}`,
          placeId,
          displayName,
          location: {
            lat: place.location?.latitude ?? 0,
            lng: place.location?.longitude ?? 0,
          },
          primaryType: place.primaryType,
          rating: place.rating,
          userRatingCount: place.userRatingCount,
          priceLevel: place.priceLevel,
          formattedAddress: place.formattedAddress,
          photoUrl,
        };
      }),
    );

    // Remove nulls (filtered-out places)
    const places = allPlaces.filter((p): p is TextSearchPlace => p !== null);

    return {
      success: true,
      places,
    };
  },
});

// Get or create a place by placeKey
export const getOrCreate = mutation({
  args: {
    placeKey: v.string(),
    provider: v.optional(v.string()),
    providerPlaceId: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Check if place exists
    const existing = await ctx.db
      .query("places")
      .withIndex("by_placeKey", (q) => q.eq("placeKey", args.placeKey))
      .first();

    if (existing) {
      // Update lastSeenAt
      await ctx.db.patch(existing._id, { lastSeenAt: Date.now() });
      return existing._id;
    }

    // Create new place
    const now = Date.now();
    const geoExpiresAt =
      args.lat !== undefined && args.lng !== undefined
        ? now + 30 * 24 * 60 * 60 * 1000
        : undefined; // 30 days

    return await ctx.db.insert("places", {
      placeKey: args.placeKey,
      provider: args.provider,
      providerPlaceId: args.providerPlaceId,
      lat: args.lat,
      lng: args.lng,
      geoExpiresAt,
      communityRatingCount: 0,
      favoritesCount: 0,
      createdAt: now,
      lastSeenAt: now,
    });
  },
});

// Get a place by placeKey
export const getByPlaceKey = query({
  args: { placeKey: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("places")
      .withIndex("by_placeKey", (q) => q.eq("placeKey", args.placeKey))
      .first();
  },
});

// Update community aggregates for a place
export const updateAggregates = mutation({
  args: {
    placeKey: v.string(),
    communityRatingAvg: v.optional(v.number()),
    communityRatingCount: v.number(),
    favoritesCount: v.number(),
  },
  handler: async (ctx, args) => {
    const place = await ctx.db
      .query("places")
      .withIndex("by_placeKey", (q) => q.eq("placeKey", args.placeKey))
      .first();

    if (!place) {
      throw new Error("Place not found");
    }

    await ctx.db.patch(place._id, {
      communityRatingAvg: args.communityRatingAvg,
      communityRatingCount: args.communityRatingCount,
      favoritesCount: args.favoritesCount,
    });
  },
});

// Increment favorites count
export const incrementFavorites = mutation({
  args: { placeKey: v.string() },
  handler: async (ctx, args) => {
    const place = await ctx.db
      .query("places")
      .withIndex("by_placeKey", (q) => q.eq("placeKey", args.placeKey))
      .first();

    if (!place) {
      throw new Error("Place not found");
    }

    await ctx.db.patch(place._id, {
      favoritesCount: place.favoritesCount + 1,
    });
  },
});

// Decrement favorites count
export const decrementFavorites = mutation({
  args: { placeKey: v.string() },
  handler: async (ctx, args) => {
    const place = await ctx.db
      .query("places")
      .withIndex("by_placeKey", (q) => q.eq("placeKey", args.placeKey))
      .first();

    if (!place) {
      throw new Error("Place not found");
    }

    await ctx.db.patch(place._id, {
      favoritesCount: Math.max(0, place.favoritesCount - 1),
    });
  },
});
