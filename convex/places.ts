import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";
import { generateSignedPhotoUrl } from "../lib/photoUrls";

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
    locationBias: v.optional(v.object({
      lat: v.number(),
      lng: v.number(),
      radiusMeters: v.optional(v.number()),
    })),
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
    locationRestriction: v.optional(v.object({
      north: v.number(),
      south: v.number(),
      east: v.number(),
      west: v.number(),
    })),
    locationBias: v.optional(v.object({
      lat: v.number(),
      lng: v.number(),
      radiusMeters: v.optional(v.number()),
    })),
    language: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    places: Array<{
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
    }>;
    error?: string;
  }> => {
    // Work around TypeScript depth limitations with complex Convex types
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const internal: any = require("./_generated/api").internal;

    const result = await ctx.runAction(internal.providerGateway.providerRequest, {
      endpointClass: "text_search",
      fieldSet: "TEXT_SEARCH",
      query: args.query,
      locationRestriction: args.locationRestriction,
      locationBias: args.locationBias,
      language: args.language ?? "en",
    });

    if (!result.success) {
      return {
        success: false,
        places: [],
        error: result.error?.message ?? "Search failed",
      };
    }

    // Extract places from the response
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = result.data as any;
    const rawPlaces = data?.places ?? [];

    // Transform to our format
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const places = await Promise.all(rawPlaces.map(async (place: any) => {
      const placeId = place.id ?? place.name?.split("/").pop() ?? "";
      
      // Extract first photo reference (policy-safe: we only store the reference, not the photo)
      // Google Places API (New) returns photos as: { name: "places/{placeId}/photos/{photoRef}", ... }
      let photoUrl: string | undefined;
      if (place.photos && place.photos.length > 0) {
        const photoName = place.photos[0]?.name;
        if (photoName) {
          // Extract photo reference from the name field
          // Format: "places/{placeId}/photos/{photoReference}"
          const parts = photoName.split("/photos/");
          if (parts.length === 2) {
            const photoReference = parts[1];
            // Generate signed URL for the photo
            try {
              photoUrl = await generateSignedPhotoUrl(placeId, photoReference, "medium");
            } catch {
              // If signing is unavailable/misconfigured, omit photos rather than failing search.
              photoUrl = undefined;
            }
          }
        }
      }
      
      return {
        placeKey: `g:${placeId}`,
        placeId,
        displayName: place.displayName?.text ?? "Unknown Place",
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
    }));

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
    const geoExpiresAt = args.lat && args.lng ? now + 30 * 24 * 60 * 60 * 1000 : undefined; // 30 days

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