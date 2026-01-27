/**
 * Place Details - Queries and Actions for place detail pages
 *
 * Combines ephemeral provider data with persistent owned data.
 * Provider data is fetched fresh via ProviderGateway (never persisted).
 * Owned data (reviews, tags, favorites) comes from Convex.
 *
 * URL patterns:
 * - Provider: /place/g/[googlePlaceId] -> placeKey = "g:" + googlePlaceId
 * - Curated: /place/c/[slug] -> placeKey = "c:" + slug
 */

import { query, action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// ============================================================================
// Public Queries - Owned Data
// ============================================================================

/**
 * Get community data for a place by placeKey
 * Includes: place stats, top tags, reviews summary
 */
export const getPlaceCommunityData = query({
  args: { placeKey: v.string() },
  handler: async (ctx, args) => {
    // Get place anchor (if exists)
    const place = await ctx.db
      .query("places")
      .withIndex("by_placeKey", (q) => q.eq("placeKey", args.placeKey))
      .first();

    // Get reviews for this place (non-deleted, sorted by recent)
    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_place_recent", (q) => q.eq("placeKey", args.placeKey))
      .order("desc")
      .take(20);

    // Filter out deleted reviews
    const activeReviews = reviews.filter((r) => !r.deletedAt);

    // Get taste tags for this place
    const tags = await ctx.db
      .query("placeTags")
      .withIndex("by_place", (q) => q.eq("placeKey", args.placeKey))
      .collect();

    // Get dish mentions
    const dishes = await ctx.db
      .query("placeDishes")
      .withIndex("by_place", (q) => q.eq("placeKey", args.placeKey))
      .collect();

    // Sort tags by net votes (up - down)
    const sortedTags = tags
      .map((t) => ({
        tag: t.tag,
        score: t.votesUp - t.votesDown,
        votesUp: t.votesUp,
        votesDown: t.votesDown,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // Sort dishes by mentions
    const sortedDishes = dishes
      .map((d) => ({
        dish: d.dish,
        mentionsCount: d.mentionsCount,
      }))
      .sort((a, b) => b.mentionsCount - a.mentionsCount)
      .slice(0, 10);

    return {
      placeKey: args.placeKey,
      stats: place
        ? {
            communityRatingAvg: place.communityRatingAvg,
            communityRatingCount: place.communityRatingCount,
            favoritesCount: place.favoritesCount,
          }
        : {
            communityRatingAvg: undefined,
            communityRatingCount: 0,
            favoritesCount: 0,
          },
      reviewCount: activeReviews.length,
      topTags: sortedTags,
      topDishes: sortedDishes,
    };
  },
});

/**
 * Get reviews for a place (paginated)
 */
export const getPlaceReviews = query({
  args: {
    placeKey: v.string(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.number()), // createdAt timestamp for pagination
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;

    let reviewsQuery = ctx.db
      .query("reviews")
      .withIndex("by_place_recent", (q) => q.eq("placeKey", args.placeKey))
      .order("desc");

    const reviews = await reviewsQuery.take(limit + 1); // +1 to check if there are more

    // Filter out deleted reviews
    const activeReviews = reviews.filter((r) => !r.deletedAt);

    // Get user info for each review
    const reviewsWithUsers = await Promise.all(
      activeReviews.slice(0, limit).map(async (review) => {
        const user = await ctx.db.get(review.userId);
        return {
          ...review,
          user: user
            ? {
                name: user.name,
                image: user.image,
              }
            : null,
        };
      })
    );

    return {
      reviews: reviewsWithUsers,
      hasMore: activeReviews.length > limit,
      nextCursor:
        activeReviews.length > limit
          ? activeReviews[limit - 1].createdAt
          : undefined,
    };
  },
});

/**
 * Check if current user has favorited this place
 */
export const getUserPlaceStatus = query({
  args: { placeKey: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return {
        isAuthenticated: false,
        hasFavorited: false,
        hasReviewed: false,
        userNote: null,
      };
    }

    // Look up user by email (the standard index available)
    const userEmail = identity.email;
    if (!userEmail) {
      return {
        isAuthenticated: true,
        hasFavorited: false,
        hasReviewed: false,
        userNote: null,
      };
    }

    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", userEmail))
      .first();

    if (!user) {
      return {
        isAuthenticated: true,
        hasFavorited: false,
        hasReviewed: false,
        userNote: null,
      };
    }

    // Check if user has a favorites list with this place
    const favList = await ctx.db
      .query("lists")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("type"), "favorites"))
      .first();

    let hasFavorited = false;
    if (favList) {
      const favItem = await ctx.db
        .query("listItems")
        .withIndex("by_list_place", (q) =>
          q.eq("listId", favList._id).eq("placeKey", args.placeKey)
        )
        .first();
      hasFavorited = !!favItem;
    }

    // Check if user has reviewed this place
    const userReview = await ctx.db
      .query("reviews")
      .withIndex("by_user_place", (q) =>
        q.eq("userId", user._id).eq("placeKey", args.placeKey)
      )
      .first();

    // Get user's personal note for this place
    const userNote = await ctx.db
      .query("userPlaceNotes")
      .withIndex("by_user_place", (q) =>
        q.eq("userId", user._id).eq("placeKey", args.placeKey)
      )
      .first();

    return {
      isAuthenticated: true,
      hasFavorited,
      hasReviewed: !!userReview && !userReview.deletedAt,
      userReviewId: userReview && !userReview.deletedAt ? userReview._id : null,
      userNote: userNote
        ? { nickname: userNote.nickname, note: userNote.note }
        : null,
    };
  },
});

/**
 * Get curated place data if exists (for overlay on provider places)
 */
export const getCuratedOverlay = query({
  args: { placeKey: v.string() },
  handler: async (ctx, args) => {
    // Check if there's a curated place linked to this provider placeKey
    const curatedPlaces = await ctx.db.query("curatedPlaces").collect();

    // Find one that has this as linkedPlaceKey
    const overlay = curatedPlaces.find(
      (cp) =>
        cp.linkedPlaceKey === args.placeKey &&
        cp.publishedAt &&
        cp.publishedAt <= Date.now()
    );

    if (!overlay) return null;

    return {
      title: overlay.title,
      summary: overlay.summary,
      mustTry: overlay.mustTry,
      priceNote: overlay.priceNote,
      tags: overlay.tags,
      coverStorageId: overlay.coverStorageId,
    };
  },
});

// ============================================================================
// Actions - Combined Data Fetching
// ============================================================================

/**
 * Provider place details response type
 */
export interface ProviderPlaceDetails {
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

/**
 * Fetch provider place details via ProviderGateway
 * This action is called from the client to get fresh provider data
 */
export const fetchProviderDetails = action({
  args: {
    googlePlaceId: v.string(),
    language: v.optional(v.string()),
    includePhotos: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    data?: ProviderPlaceDetails;
    error?: { code: string; message: string };
  }> => {
    const fieldSet = args.includePhotos
      ? "PLACE_DETAILS_WITH_PHOTOS"
      : "PLACE_DETAILS_STANDARD";

    // @ts-expect-error - TypeScript depth limit with complex Convex types
    const result = await ctx.runAction(internal.providerGateway.providerRequest, {
      fieldSet,
      endpointClass: "place_details",
      placeId: args.googlePlaceId,
      language: (args.language as "ar" | "fr" | "en") ?? "en",
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error,
      };
    }

    return {
      success: true,
      data: result.data as ProviderPlaceDetails,
    };
  },
});

/**
 * Ensure place anchor exists and update lastSeenAt
 * Called when viewing a place to maintain the places table
 */
export const ensurePlaceAnchor = internalQuery({
  args: {
    placeKey: v.string(),
    provider: v.optional(v.string()),
    providerPlaceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("places")
      .withIndex("by_placeKey", (q) => q.eq("placeKey", args.placeKey))
      .first();

    return existing;
  },
});
