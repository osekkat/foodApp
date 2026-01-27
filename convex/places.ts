import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Places queries and mutations
 *
 * Policy Reminders:
 * - NEVER persist provider content (name/address/phone/hours/ratings/photos)
 * - ONLY persist: placeKey, lat/lng (with expiry), community aggregates
 */

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
