/**
 * User Profile - Queries and mutations for user profile pages
 *
 * Provides data for:
 * - Profile header (user info, stats)
 * - User's reviews
 * - User's lists and favorites
 * - User preferences/settings
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAuth, getAuthUser } from "./auth/rbac";

// ============================================================================
// Profile Data Queries
// ============================================================================

/**
 * Get the current user's profile data
 */
export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await getAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const user = await ctx.db.get(authUser.userId);
    if (!user) return null;

    // Get review count
    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_user", (q) => q.eq("userId", authUser.userId))
      .collect();
    const activeReviews = reviews.filter((r) => !r.deletedAt);

    // Get helpful votes received
    const helpfulVotes = await Promise.all(
      activeReviews.map((review) =>
        ctx.db
          .query("reviewHelpful")
          .withIndex("by_review", (q) => q.eq("reviewId", review._id))
          .collect()
      )
    );
    const totalHelpfulVotes = helpfulVotes.flat().length;

    // Get lists count
    const lists = await ctx.db
      .query("lists")
      .withIndex("by_user", (q) => q.eq("userId", authUser.userId))
      .collect();

    // Get favorites count
    const favoritesList = lists.find((l) => l.type === "favorites");
    const favoritesCount = favoritesList?.itemCount ?? 0;

    // Get user preferences
    const preferences = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", authUser.userId))
      .first();

    return {
      id: user._id,
      name: user.name,
      email: user.email,
      image: user.image,
      locale: user.locale,
      createdAt: user.createdAt,
      stats: {
        reviewCount: activeReviews.length,
        helpfulVotesReceived: totalHelpfulVotes,
        listsCount: lists.length,
        favoritesCount,
      },
      preferences: preferences
        ? {
            analyticsOptOut: preferences.analyticsOptOut,
            defaultCity: preferences.defaultCity,
            mapStyle: preferences.mapStyle,
            distanceUnit: preferences.distanceUnit,
          }
        : {
            analyticsOptOut: false,
            defaultCity: undefined,
            mapStyle: "standard",
            distanceUnit: "km",
          },
    };
  },
});

/**
 * Get user's reviews (paginated)
 */
export const getMyReviews = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUser(ctx);
    if (!authUser) {
      return { reviews: [], hasMore: false };
    }

    const limit = args.limit ?? 10;

    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_user", (q) => q.eq("userId", authUser.userId))
      .order("desc")
      .take(limit + 1);

    const activeReviews = reviews.filter((r) => !r.deletedAt);

    // Get place info for each review (just the placeKey for now)
    const reviewsWithPlaces = activeReviews.slice(0, limit).map((review) => ({
      _id: review._id,
      placeKey: review.placeKey,
      rating: review.rating,
      text: review.text,
      dishesTried: review.dishesTried,
      helpfulCount: review.helpfulCount,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    }));

    return {
      reviews: reviewsWithPlaces,
      hasMore: activeReviews.length > limit,
    };
  },
});

/**
 * Get user's lists
 */
export const getMyLists = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await getAuthUser(ctx);
    if (!authUser) {
      return [];
    }

    const lists = await ctx.db
      .query("lists")
      .withIndex("by_user", (q) => q.eq("userId", authUser.userId))
      .collect();

    return lists.map((list) => ({
      _id: list._id,
      name: list.name,
      type: list.type,
      visibility: list.visibility,
      itemCount: list.itemCount,
      description: list.description,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
    }));
  },
});

/**
 * Get items from user's favorites list
 */
export const getMyFavorites = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUser(ctx);
    if (!authUser) {
      return { items: [], hasMore: false };
    }

    const limit = args.limit ?? 20;

    // Find favorites list
    const favoritesList = await ctx.db
      .query("lists")
      .withIndex("by_user", (q) => q.eq("userId", authUser.userId))
      .filter((q) => q.eq(q.field("type"), "favorites"))
      .first();

    if (!favoritesList) {
      return { items: [], hasMore: false };
    }

    // Get list items
    const items = await ctx.db
      .query("listItems")
      .withIndex("by_list", (q) => q.eq("listId", favoritesList._id))
      .order("desc")
      .take(limit + 1);

    // Get user notes for each place
    const itemsWithNotes = await Promise.all(
      items.slice(0, limit).map(async (item) => {
        const note = await ctx.db
          .query("userPlaceNotes")
          .withIndex("by_user_place", (q) =>
            q.eq("userId", authUser.userId).eq("placeKey", item.placeKey)
          )
          .first();

        return {
          _id: item._id,
          placeKey: item.placeKey,
          createdAt: item.createdAt,
          note: note?.note,
          nickname: note?.nickname,
        };
      })
    );

    return {
      items: itemsWithNotes,
      hasMore: items.length > limit,
    };
  },
});

// ============================================================================
// Profile Settings Mutations
// ============================================================================

/**
 * Update user profile
 */
export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    locale: v.optional(v.union(v.literal("ar"), v.literal("fr"), v.literal("en"))),
  },
  handler: async (ctx, args) => {
    const authUser = await requireAuth(ctx);

    const updates: Record<string, unknown> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.locale !== undefined) updates.locale = args.locale;

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(authUser.userId, updates);
    }

    return { success: true };
  },
});

/**
 * Update user preferences
 */
export const updatePreferences = mutation({
  args: {
    analyticsOptOut: v.optional(v.boolean()),
    defaultCity: v.optional(v.string()),
    mapStyle: v.optional(v.string()),
    distanceUnit: v.optional(v.union(v.literal("km"), v.literal("mi"))),
  },
  handler: async (ctx, args) => {
    const authUser = await requireAuth(ctx);

    // Get existing preferences
    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", authUser.userId))
      .first();

    const updates = {
      analyticsOptOut: args.analyticsOptOut ?? existing?.analyticsOptOut ?? false,
      defaultCity: args.defaultCity ?? existing?.defaultCity,
      mapStyle: args.mapStyle ?? existing?.mapStyle ?? "standard",
      distanceUnit: args.distanceUnit ?? existing?.distanceUnit ?? "km",
    };

    if (existing) {
      await ctx.db.patch(existing._id, updates);
    } else {
      await ctx.db.insert("userPreferences", {
        userId: authUser.userId,
        ...updates,
      });
    }

    return { success: true };
  },
});

/**
 * Delete a user's review
 */
export const deleteMyReview = mutation({
  args: {
    reviewId: v.id("reviews"),
  },
  handler: async (ctx, args) => {
    const authUser = await requireAuth(ctx);

    const review = await ctx.db.get(args.reviewId);
    if (!review) {
      throw new Error("Review not found");
    }

    // Verify ownership
    if (review.userId !== authUser.userId) {
      throw new Error("You can only delete your own reviews");
    }

    // Soft delete
    await ctx.db.patch(args.reviewId, { deletedAt: Date.now() });

    return { success: true };
  },
});
