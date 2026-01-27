/**
 * Taste Tags & Dish Aggregation - Community-driven content
 *
 * Implements:
 * 1. Tag voting - community can vote on tags for places (tagine, couscous, seafood, etc.)
 * 2. Dish aggregation - tracks which dishes are mentioned for each place
 *
 * POLICY: All content is owned. Tags and dishes are community-generated.
 */

import { query, mutation, internalMutation, MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";

// ============================================================================
// Types & Configuration
// ============================================================================

/**
 * Predefined taste tags - normalized keys
 */
export const TASTE_TAGS = [
  "tagine",
  "couscous",
  "seafood",
  "grilled",
  "pastries",
  "coffee",
  "tea",
  "breakfast",
  "vegetarian",
  "traditional",
  "modern",
  "rooftop",
  "family-friendly",
  "romantic",
  "quick-service",
  "fine-dining",
  "street-food",
  "halal",
  "local-favorite",
  "tourist-friendly",
] as const;

export type TasteTag = (typeof TASTE_TAGS)[number];

/**
 * Tag normalization - lowercase, trim, alphanumeric + hyphen only
 */
function normalizeTag(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Dish normalization - lowercase, trim
 */
function normalizeDish(dish: string): string {
  return dish.toLowerCase().trim();
}

// ============================================================================
// Auth Helpers
// ============================================================================

/**
 * Get authenticated user from session (optional - allows anonymous voting)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getAuthUser(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.email) return null;

  const user = await ctx.db
    .query("users")
    .withIndex("email", (q: any) => q.eq("email", identity.email))
    .first();

  return user;
}

// ============================================================================
// Tag Voting
// ============================================================================

/**
 * Vote on a tag for a place
 *
 * Allows anonymous voting with rate limiting.
 * Each vote either adds to votesUp or votesDown.
 */
export const voteTag = mutation({
  args: {
    placeKey: v.string(),
    tag: v.string(),
    vote: v.union(v.literal("up"), v.literal("down")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const normalizedTag = normalizeTag(args.tag);

    // Validate tag is not empty after normalization
    if (!normalizedTag) {
      throw new ConvexError({
        code: "INVALID_TAG",
        message: "Tag cannot be empty",
      });
    }

    // Get user (optional - anonymous allowed)
    const user = await getAuthUser(ctx);
    const userId = user?._id;

    // Check for existing tag record
    const existingTags = await ctx.db
      .query("placeTags")
      .withIndex("by_place", (q) => q.eq("placeKey", args.placeKey))
      .collect();

    const existing = existingTags.find((t) => t.tag === normalizedTag);

    if (existing) {
      // Update existing tag
      const update =
        args.vote === "up"
          ? { votesUp: existing.votesUp + 1 }
          : { votesDown: existing.votesDown + 1 };

      await ctx.db.patch(existing._id, {
        ...update,
        updatedAt: now,
      });

      return {
        tagId: existing._id,
        tag: normalizedTag,
        votesUp: args.vote === "up" ? existing.votesUp + 1 : existing.votesUp,
        votesDown: args.vote === "down" ? existing.votesDown + 1 : existing.votesDown,
      };
    } else {
      // Create new tag record
      const tagId = await ctx.db.insert("placeTags", {
        placeKey: args.placeKey,
        tag: normalizedTag,
        votesUp: args.vote === "up" ? 1 : 0,
        votesDown: args.vote === "down" ? 1 : 0,
        updatedAt: now,
      });

      return {
        tagId,
        tag: normalizedTag,
        votesUp: args.vote === "up" ? 1 : 0,
        votesDown: args.vote === "down" ? 1 : 0,
      };
    }
  },
});

/**
 * Get tags for a place, sorted by net votes (up - down)
 */
export const getPlaceTags = query({
  args: {
    placeKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;

    const tags = await ctx.db
      .query("placeTags")
      .withIndex("by_place", (q) => q.eq("placeKey", args.placeKey))
      .collect();

    // Sort by net votes (up - down), then by total engagement
    return tags
      .map((t) => ({
        ...t,
        netVotes: t.votesUp - t.votesDown,
        totalVotes: t.votesUp + t.votesDown,
      }))
      .sort((a, b) => {
        // Primary: net votes
        if (b.netVotes !== a.netVotes) return b.netVotes - a.netVotes;
        // Secondary: total engagement
        return b.totalVotes - a.totalVotes;
      })
      .slice(0, limit);
  },
});

/**
 * Get suggested tags (predefined list not yet voted for this place)
 */
export const getSuggestedTags = query({
  args: { placeKey: v.string() },
  handler: async (ctx, args) => {
    const existingTags = await ctx.db
      .query("placeTags")
      .withIndex("by_place", (q) => q.eq("placeKey", args.placeKey))
      .collect();

    const existingTagSet = new Set(existingTags.map((t) => t.tag));

    // Return predefined tags not yet used for this place
    return TASTE_TAGS.filter((tag) => !existingTagSet.has(tag));
  },
});

// ============================================================================
// Dish Aggregation
// ============================================================================

/**
 * Update dish mentions for a place
 *
 * Called when:
 * - Review is created/updated with dishesTried
 * - Curated card is created/updated with mustTry
 *
 * This is an internal mutation to be called from reviews/curatedPlaces
 */
export const updateDishMentions = internalMutation({
  args: {
    placeKey: v.string(),
    dishes: v.array(v.string()),
    source: v.union(v.literal("review"), v.literal("curated")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    for (const dish of args.dishes) {
      const normalized = normalizeDish(dish);
      if (!normalized) continue;

      // Find existing dish record
      const existingDishes = await ctx.db
        .query("placeDishes")
        .withIndex("by_place", (q) => q.eq("placeKey", args.placeKey))
        .collect();

      const existing = existingDishes.find((d) => d.dish === normalized);

      if (existing) {
        await ctx.db.patch(existing._id, {
          mentionsCount: existing.mentionsCount + 1,
          lastMentionedAt: now,
          updatedAt: now,
        });
      } else {
        // Generate searchable text with transliteration variants
        const searchableText = generateDishSearchText(normalized);

        await ctx.db.insert("placeDishes", {
          placeKey: args.placeKey,
          dish: normalized,
          mentionsCount: 1,
          lastMentionedAt: now,
          updatedAt: now,
          searchableText,
        });
      }
    }

    return { success: true, dishCount: args.dishes.length };
  },
});

/**
 * Generate searchable text for a dish including transliteration variants
 * Duplicated from transliteration.ts for Convex runtime
 */
function generateDishSearchText(dish: string): string {
  const DISH_TRANSLITERATIONS: Record<string, string[]> = {
    tagine: ["tajine", "طاجين", "طجين"],
    couscous: ["كسكس", "كسكسو", "kuskus"],
    pastilla: ["bastilla", "بسطيلة"],
    harira: ["حريرة", "hrira"],
    msemen: ["مسمن", "msemmen"],
    baghrir: ["بغرير", "beghrir"],
    kefta: ["كفتة", "kofta", "kafta"],
    brochettes: ["بروشات", "brochette", "skewers"],
    rfissa: ["رفيسة", "trid"],
    zaalouk: ["زعلوك"],
    taktouka: ["تكتوكة"],
    bissara: ["بصارة", "bessara"],
    chebakia: ["شباكية"],
    briouates: ["بريوات", "briouate"],
  };

  const variants = DISH_TRANSLITERATIONS[dish] || [];
  return [dish, ...variants].join(" ");
}

/**
 * Get top dishes for a place (for "What to Order" feature)
 */
export const getTopDishes = query({
  args: {
    placeKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 5;

    const dishes = await ctx.db
      .query("placeDishes")
      .withIndex("by_place", (q) => q.eq("placeKey", args.placeKey))
      .collect();

    // Sort by mentions count
    return dishes.sort((a, b) => b.mentionsCount - a.mentionsCount).slice(0, limit);
  },
});

/**
 * Get all dishes mentioned across places (for discovery)
 */
export const getPopularDishes = query({
  args: {
    limit: v.optional(v.number()),
    city: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    // Get all dish mentions
    const allDishes = await ctx.db.query("placeDishes").collect();

    // Aggregate by dish name
    const dishCounts: Record<string, { dish: string; totalMentions: number; placeCount: number }> =
      {};

    for (const d of allDishes) {
      if (!dishCounts[d.dish]) {
        dishCounts[d.dish] = { dish: d.dish, totalMentions: 0, placeCount: 0 };
      }
      dishCounts[d.dish].totalMentions += d.mentionsCount;
      dishCounts[d.dish].placeCount += 1;
    }

    // Sort by total mentions
    return Object.values(dishCounts)
      .sort((a, b) => b.totalMentions - a.totalMentions)
      .slice(0, limit);
  },
});

/**
 * Search dishes by name
 */
export const searchDishes = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    if (!args.query.trim()) {
      return [];
    }

    // Use search index
    const results = await ctx.db
      .query("placeDishes")
      .withSearchIndex("search_dishes", (q) => q.search("searchableText", args.query))
      .take(limit);

    return results;
  },
});

// ============================================================================
// Dish Explorer - Find Places by Dish
// ============================================================================

/**
 * Dish Explorer: Find the best places for a specific dish
 *
 * Ranking uses ONLY owned signals (no provider data):
 * - Dish mentions weighted highest (x3)
 * - Recent reviews (x2)
 * - Favorites count (x1)
 *
 * This query works in degraded modes since it uses only owned data.
 */
export const exploreDish = query({
  args: {
    dish: v.string(),
    city: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const normalized = normalizeDish(args.dish);

    if (!normalized) {
      return { places: [], dish: args.dish, totalCount: 0 };
    }

    // Get all places that have this dish mentioned
    const dishMentions = await ctx.db
      .query("placeDishes")
      .withIndex("by_dish", (q) => q.eq("dish", normalized))
      .collect();

    if (dishMentions.length === 0) {
      return { places: [], dish: normalized, totalCount: 0 };
    }

    // Get place data for scoring
    const placesWithScores = await Promise.all(
      dishMentions.map(async (dm) => {
        // Get place anchor data
        const place = await ctx.db
          .query("places")
          .withIndex("by_placeKey", (q) => q.eq("placeKey", dm.placeKey))
          .first();

        // Get curated card if exists
        const curatedCard = await ctx.db
          .query("curatedPlaces")
          .filter((q) =>
            q.or(
              q.eq(q.field("placeKey"), dm.placeKey),
              q.eq(q.field("linkedPlaceKey"), dm.placeKey)
            )
          )
          .first();

        // Count recent reviews (last 30 days)
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const recentReviews = await ctx.db
          .query("reviews")
          .withIndex("by_place_recent", (q) =>
            q.eq("placeKey", dm.placeKey).gte("createdAt", thirtyDaysAgo)
          )
          .collect();

        const recentReviewCount = recentReviews.filter((r) => !r.deletedAt).length;

        // Calculate dish score
        const dishScore =
          dm.mentionsCount * 3 + // Dish mentions weighted highest
          recentReviewCount * 2 + // Recent reviews
          (place?.favoritesCount ?? 0) * 1; // Favorites count

        return {
          placeKey: dm.placeKey,
          dish: dm.dish,
          dishMentions: dm.mentionsCount,
          lastMentionedAt: dm.lastMentionedAt,
          favoritesCount: place?.favoritesCount ?? 0,
          recentReviewCount,
          communityRating: place?.communityRatingAvg,
          communityRatingCount: place?.communityRatingCount ?? 0,
          // Curated card data if available
          curatedTitle: curatedCard?.title,
          curatedSummary: curatedCard?.summary,
          curatedNeighborhood: curatedCard?.neighborhood,
          curatedMustTry: curatedCard?.mustTry,
          isCurated: !!curatedCard,
          city: curatedCard?.city,
          dishScore,
        };
      })
    );

    // Filter by city if specified
    const filtered = args.city
      ? placesWithScores.filter((p) => p.city === args.city)
      : placesWithScores;

    // Sort by dish score
    const sorted = filtered.sort((a, b) => b.dishScore - a.dishScore).slice(0, limit);

    return {
      places: sorted,
      dish: normalized,
      totalCount: filtered.length,
    };
  },
});

/**
 * Get dish quick-picks for home page
 *
 * Returns predefined popular dishes with localized labels
 */
export const getDishQuickPicks = query({
  handler: async () => {
    return [
      { dish: "tagine", label: "Tagine", labelAr: "طاجين", labelFr: "Tajine" },
      { dish: "couscous", label: "Couscous", labelAr: "كسكس", labelFr: "Couscous" },
      { dish: "pastilla", label: "Pastilla", labelAr: "بسطيلة", labelFr: "Pastilla" },
      { dish: "seafood", label: "Seafood", labelAr: "مأكولات بحرية", labelFr: "Fruits de mer" },
      { dish: "coffee", label: "Coffee", labelAr: "قهوة", labelFr: "Café" },
      { dish: "pastries", label: "Pastries", labelAr: "حلويات", labelFr: "Pâtisseries" },
      { dish: "harira", label: "Harira", labelAr: "حريرة", labelFr: "Harira" },
      { dish: "msemen", label: "Msemen", labelAr: "مسمن", labelFr: "Msemen" },
    ];
  },
});

// ============================================================================
// Helper for Reviews Integration
// ============================================================================

/**
 * Called by reviews.ts when a review is created/updated
 * This creates dish aggregation records
 */
export async function aggregateDishesFromReview(
  ctx: MutationCtx,
  placeKey: string,
  dishesTried: string[] | undefined
): Promise<void> {
  if (!dishesTried || dishesTried.length === 0) return;

  const now = Date.now();

  for (const dish of dishesTried) {
    const normalized = normalizeDish(dish);
    if (!normalized) continue;

    // Find existing dish record
    const existingDishes = await ctx.db
      .query("placeDishes")
      .withIndex("by_place", (q) => q.eq("placeKey", placeKey))
      .collect();

    const existing = existingDishes.find((d) => d.dish === normalized);

    if (existing) {
      await ctx.db.patch(existing._id, {
        mentionsCount: existing.mentionsCount + 1,
        lastMentionedAt: now,
        updatedAt: now,
      });
    } else {
      const searchableText = generateDishSearchText(normalized);

      await ctx.db.insert("placeDishes", {
        placeKey,
        dish: normalized,
        mentionsCount: 1,
        lastMentionedAt: now,
        updatedAt: now,
        searchableText,
      });
    }
  }
}
