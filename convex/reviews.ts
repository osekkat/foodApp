/**
 * Reviews - User-Generated Content with One-Per-User-Per-Place Policy
 *
 * Implements review CRUD with the following policies:
 * - One review per user per place (subsequent submissions update existing review)
 * - Edit history recorded for moderation/audit
 * - Soft delete preserves audit trail
 * - Aggregates (communityRatingAvg, communityRatingCount) updated on changes
 * - Helpful votes functionality
 *
 * POLICY: placeKey references only (never provider content)
 */

import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id, Doc } from "./_generated/dataModel";
import { aggregateDishesFromReview } from "./tags";

// ============================================================================
// Types
// ============================================================================

export type PriceBucket = "<30" | "30-70" | "70-150" | "150+";
export type VisitContext = "solo" | "couple" | "family" | "friends" | "business";

// ============================================================================
// Auth Helpers
// ============================================================================

/**
 * Get authenticated user from session
 */
async function getAuthUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.email) return null;

  const user = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", identity.email))
    .first();

  return user;
}

/**
 * Require authenticated user (throws if not authenticated)
 */
async function requireAuthUser(ctx: QueryCtx | MutationCtx) {
  const user = await getAuthUser(ctx);
  if (!user) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "Authentication required",
    });
  }
  return user;
}

// ============================================================================
// Review CRUD
// ============================================================================

/**
 * Upsert review - creates or updates a review for a place
 *
 * POLICY: One review per user per place. If user has existing review,
 * this updates it and records edit history.
 */
export const upsertReview = mutation({
  args: {
    placeKey: v.string(),
    rating: v.number(), // 1-5
    text: v.optional(v.string()), // 10-2000 chars
    dishesTried: v.optional(v.array(v.string())), // 0-10 items
    pricePaidBucketMad: v.optional(
      v.union(
        v.literal("<30"),
        v.literal("30-70"),
        v.literal("70-150"),
        v.literal("150+")
      )
    ),
    visitContext: v.optional(
      v.union(
        v.literal("solo"),
        v.literal("couple"),
        v.literal("family"),
        v.literal("friends"),
        v.literal("business")
      )
    ),
    photoIds: v.optional(v.array(v.id("ugcPhotos"))),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const now = Date.now();

    // Validate rating
    if (args.rating < 1 || args.rating > 5 || !Number.isInteger(args.rating)) {
      throw new ConvexError({
        code: "INVALID_RATING",
        message: "Rating must be an integer between 1 and 5",
      });
    }

    // Validate text length if provided
    if (args.text !== undefined) {
      if (args.text.length < 10 || args.text.length > 2000) {
        throw new ConvexError({
          code: "INVALID_TEXT_LENGTH",
          message: "Review text must be between 10 and 2000 characters",
        });
      }
    }

    // Validate dishes tried
    if (args.dishesTried !== undefined) {
      if (args.dishesTried.length > 10) {
        throw new ConvexError({
          code: "TOO_MANY_DISHES",
          message: "Maximum 10 dishes can be listed",
        });
      }
      for (const dish of args.dishesTried) {
        if (dish.length < 1 || dish.length > 40) {
          throw new ConvexError({
            code: "INVALID_DISH_NAME",
            message: "Dish names must be between 1 and 40 characters",
          });
        }
      }
    }

    // Check for existing review
    const existing = await ctx.db
      .query("reviews")
      .withIndex("by_user_place", (q) =>
        q.eq("userId", user._id).eq("placeKey", args.placeKey)
      )
      .first();

    let reviewId: Id<"reviews">;
    let isNewReview = false;

    if (existing) {
      // Update existing review - record edit history first
      if (existing.text !== args.text) {
        await ctx.db.insert("reviewEdits", {
          reviewId: existing._id,
          editorUserId: user._id,
          prevText: existing.text,
          nextText: args.text,
          editedAt: now,
        });
      }

      // Patch the existing review
      await ctx.db.patch(existing._id, {
        rating: args.rating,
        text: args.text,
        dishesTried: args.dishesTried,
        pricePaidBucketMad: args.pricePaidBucketMad,
        visitContext: args.visitContext,
        photoIds: args.photoIds,
        updatedAt: now,
        // Clear deletedAt if re-submitting a soft-deleted review
        deletedAt: undefined,
      });

      reviewId = existing._id;
    } else {
      // Create new review
      reviewId = await ctx.db.insert("reviews", {
        userId: user._id,
        placeKey: args.placeKey,
        rating: args.rating,
        text: args.text,
        dishesTried: args.dishesTried,
        pricePaidBucketMad: args.pricePaidBucketMad,
        visitContext: args.visitContext,
        photoIds: args.photoIds,
        helpfulCount: 0,
        createdAt: now,
      });

      isNewReview = true;

      // Increment user's review count
      if (user.reviewCount !== undefined) {
        await ctx.db.patch(user._id, {
          reviewCount: user.reviewCount + 1,
        });
      }
    }

    // Update place aggregates
    await updatePlaceAggregates(ctx, args.placeKey);

    // Aggregate dish mentions (only for new reviews or if dishes changed)
    if (isNewReview || args.dishesTried) {
      await aggregateDishesFromReview(ctx, args.placeKey, args.dishesTried);
    }

    return { reviewId, isNewReview };
  },
});

/**
 * Soft delete a review - preserves for audit/moderation
 */
export const deleteReview = mutation({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const now = Date.now();

    const review = await ctx.db.get(args.reviewId);
    if (!review) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Review not found",
      });
    }

    // Only the author can delete their review
    if (review.userId !== user._id) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You can only delete your own reviews",
      });
    }

    // Soft delete
    await ctx.db.patch(args.reviewId, {
      deletedAt: now,
    });

    // Update place aggregates
    await updatePlaceAggregates(ctx, review.placeKey);

    return { success: true };
  },
});

/**
 * Get a user's review for a specific place
 */
export const getUserReviewForPlace = query({
  args: { placeKey: v.string() },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return null;

    const review = await ctx.db
      .query("reviews")
      .withIndex("by_user_place", (q) =>
        q.eq("userId", user._id).eq("placeKey", args.placeKey)
      )
      .first();

    // Don't return soft-deleted reviews
    if (review?.deletedAt) return null;

    return review;
  },
});

/**
 * Get reviews for a place (excluding soft-deleted)
 */
export const getReviewsForPlace = query({
  args: {
    placeKey: v.string(),
    limit: v.optional(v.number()),
    sortBy: v.optional(v.union(v.literal("recent"), v.literal("helpful"))),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    let reviews = await ctx.db
      .query("reviews")
      .withIndex("by_place_recent", (q) => q.eq("placeKey", args.placeKey))
      .order("desc")
      .take(limit * 2); // Over-fetch to account for soft-deleted

    // Filter out soft-deleted
    reviews = reviews.filter((r) => !r.deletedAt);

    // Sort by helpful if requested
    if (args.sortBy === "helpful") {
      reviews.sort((a, b) => b.helpfulCount - a.helpfulCount);
    }

    // Trim to limit
    reviews = reviews.slice(0, limit);

    // Enrich with user info
    const enrichedReviews = await Promise.all(
      reviews.map(async (review) => {
        const author = await ctx.db.get(review.userId);
        return {
          ...review,
          author: author
            ? {
                name: author.name,
                image: author.image,
              }
            : null,
        };
      })
    );

    return enrichedReviews;
  },
});

/**
 * Get a user's reviews
 */
export const getUserReviews = query({
  args: {
    userId: v.optional(v.id("users")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // If no userId provided, get current user's reviews
    const targetUserId = args.userId ?? (await getAuthUser(ctx))?._id;
    if (!targetUserId) return [];

    const limit = args.limit ?? 20;

    let reviews = await ctx.db
      .query("reviews")
      .withIndex("by_user", (q) => q.eq("userId", targetUserId))
      .order("desc")
      .take(limit * 2);

    // Filter out soft-deleted
    reviews = reviews.filter((r) => !r.deletedAt);

    return reviews.slice(0, limit);
  },
});

// ============================================================================
// Helpful Votes
// ============================================================================

/**
 * Mark a review as helpful
 */
export const markReviewHelpful = mutation({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const now = Date.now();

    const review = await ctx.db.get(args.reviewId);
    if (!review || review.deletedAt) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Review not found",
      });
    }

    // Can't vote on own review
    if (review.userId === user._id) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You cannot mark your own review as helpful",
      });
    }

    // Check if already voted
    const existingVote = await ctx.db
      .query("reviewHelpful")
      .withIndex("by_user_review", (q) =>
        q.eq("userId", user._id).eq("reviewId", args.reviewId)
      )
      .first();

    if (existingVote) {
      throw new ConvexError({
        code: "ALREADY_VOTED",
        message: "You have already marked this review as helpful",
      });
    }

    // Record the vote
    await ctx.db.insert("reviewHelpful", {
      reviewId: args.reviewId,
      userId: user._id,
      createdAt: now,
    });

    // Increment helpful count on review
    await ctx.db.patch(args.reviewId, {
      helpfulCount: review.helpfulCount + 1,
    });

    // Increment helpful votes received on review author
    const author = await ctx.db.get(review.userId);
    if (author && author.helpfulVotesReceived !== undefined) {
      await ctx.db.patch(review.userId, {
        helpfulVotesReceived: author.helpfulVotesReceived + 1,
      });
    }

    return { success: true };
  },
});

/**
 * Remove helpful vote
 */
export const unmarkReviewHelpful = mutation({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    const review = await ctx.db.get(args.reviewId);
    if (!review) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Review not found",
      });
    }

    // Find the vote
    const vote = await ctx.db
      .query("reviewHelpful")
      .withIndex("by_user_review", (q) =>
        q.eq("userId", user._id).eq("reviewId", args.reviewId)
      )
      .first();

    if (!vote) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "You have not marked this review as helpful",
      });
    }

    // Delete the vote
    await ctx.db.delete(vote._id);

    // Decrement helpful count on review
    await ctx.db.patch(args.reviewId, {
      helpfulCount: Math.max(0, review.helpfulCount - 1),
    });

    // Decrement helpful votes received on review author
    const author = await ctx.db.get(review.userId);
    if (author && author.helpfulVotesReceived !== undefined) {
      await ctx.db.patch(review.userId, {
        helpfulVotesReceived: Math.max(0, author.helpfulVotesReceived - 1),
      });
    }

    return { success: true };
  },
});

/**
 * Check if current user has marked a review as helpful
 */
export const hasMarkedHelpful = query({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return false;

    const vote = await ctx.db
      .query("reviewHelpful")
      .withIndex("by_user_review", (q) =>
        q.eq("userId", user._id).eq("reviewId", args.reviewId)
      )
      .first();

    return !!vote;
  },
});

// ============================================================================
// Aggregates
// ============================================================================

/**
 * Update place aggregates (communityRatingAvg, communityRatingCount)
 * Called after review create/update/delete
 */
async function updatePlaceAggregates(
  ctx: MutationCtx,
  placeKey: string
): Promise<void> {
  // Get all non-deleted reviews for this place
  const reviews = await ctx.db
    .query("reviews")
    .withIndex("by_place", (q) => q.eq("placeKey", placeKey))
    .collect();

  const activeReviews = reviews.filter((r) => !r.deletedAt);

  const count = activeReviews.length;
  const avg =
    count > 0
      ? activeReviews.reduce((sum, r) => sum + r.rating, 0) / count
      : undefined;

  // Find or create place record
  let place = await ctx.db
    .query("places")
    .withIndex("by_placeKey", (q) => q.eq("placeKey", placeKey))
    .first();

  if (place) {
    await ctx.db.patch(place._id, {
      communityRatingAvg: avg,
      communityRatingCount: count,
      lastSeenAt: Date.now(),
    });
  } else {
    // Create place record if it doesn't exist
    await ctx.db.insert("places", {
      placeKey,
      communityRatingAvg: avg,
      communityRatingCount: count,
      favoritesCount: 0,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
  }
}

// ============================================================================
// Edit History (for moderation)
// ============================================================================

/**
 * Get edit history for a review (moderator only)
 */
export const getReviewEditHistory = query({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "Authentication required",
      });
    }

    // Check if user is the review owner or a moderator
    const review = await ctx.db.get(args.reviewId);
    if (!review) return [];

    const isOwner = review.userId === user._id;

    // Check for moderator role
    const userRole = await ctx.db
      .query("userRoles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    const isModerator =
      userRole?.role === "admin" || userRole?.role === "moderator";

    if (!isOwner && !isModerator) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Not authorized to view edit history",
      });
    }

    const edits = await ctx.db
      .query("reviewEdits")
      .withIndex("by_review", (q) => q.eq("reviewId", args.reviewId))
      .order("desc")
      .collect();

    return edits;
  },
});
