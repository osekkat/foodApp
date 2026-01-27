/**
 * Search - Full-text search over owned content
 *
 * Implements the "owned search" track:
 * - Curated place cards: title, summary, mustTry, tags
 * - Guides: title, description
 * - Reviews: text, dishesTried
 * - Dish mentions: placeDishes.dish
 *
 * All search is normalized via transliteration:
 * - Index-time: content expanded with AR/FR/EN variants
 * - Query-time: user input normalized to canonical form
 *
 * POLICY: Only owned content is indexed. Provider content is never stored.
 */

import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

// ============================================================================
// Transliteration Integration
// ============================================================================

// Note: We import transliteration functions from lib/transliteration.ts
// Since Convex runs in a Node.js-like environment, we can use relative imports
// However, for server-side code, we need to inline or bundle the functions

/**
 * Moroccan food transliterations (subset for Convex runtime)
 * Full version in lib/transliteration.ts
 */
const MOROCCAN_FOOD_TRANSLITERATIONS: Record<string, string[]> = {
  tagine: ["tajine", "طاجين", "طجين", "الطاجين"],
  couscous: ["كسكس", "كسكسو", "الكسكس", "koskos", "kuskus"],
  pastilla: ["bastilla", "bestilla", "بسطيلة", "البسطيلة", "pastela"],
  harira: ["حريرة", "الحريرة", "hrira"],
  tanjia: ["tangia", "طنجية", "الطنجية"],
  mechoui: ["meshwi", "مشوي", "المشوي", "mchoui"],
  rfissa: ["رفيسة", "الرفيسة", "trid"],
  mrouzia: ["مروزية", "المروزية"],
  kefta: ["كفتة", "الكفتة", "kofta", "kofte", "kafta"],
  brochettes: ["بروشات", "شواء", "brochette", "skewers"],
  msemen: ["مسمن", "المسمن", "msemmen", "rghaif"],
  baghrir: ["بغرير", "البغرير", "beghrir"],
  harcha: ["حرشة", "الحرشة"],
  khobz: ["خبز", "الخبز", "bread", "pain"],
  chebakia: ["شباكية", "الشباكية", "chebakiya"],
  briouates: ["بريوات", "البريوات", "briouate", "briwat"],
  zaalouk: ["زعلوك", "الزعلوك"],
  taktouka: ["تكتوكة", "التكتوكة"],
  bissara: ["بصارة", "البصارة", "bessara"],
  atay: ["أتاي", "الشاي", "mint tea", "the menthe", "moroccan tea"],
  smen: ["سمن", "السمن", "preserved butter"],
  chermoula: ["شرمولة", "الشرمولة", "charmoula"],
  marrakech: ["مراكش", "المراكشي", "marrakeshi"],
  fes: ["فاس", "الفاسي", "fassi", "fez"],
  casablanca: ["الدار البيضاء", "كازابلانكا", "casa"],
  tangier: ["طنجة", "الطنجي", "tanger"],
  restaurant: ["مطعم", "المطعم", "resto"],
  cafe: ["مقهى", "قهوة", "coffee", "kahwa"],
};

// Build reverse lookup
const VARIANT_TO_CANONICAL: Map<string, string> = new Map();
for (const [canonical, variants] of Object.entries(MOROCCAN_FOOD_TRANSLITERATIONS)) {
  for (const variant of variants) {
    VARIANT_TO_CANONICAL.set(variant.toLowerCase(), canonical);
  }
  VARIANT_TO_CANONICAL.set(canonical.toLowerCase(), canonical);
}

/**
 * Arabic text normalization for search
 */
function normalizeArabic(text: string): string {
  return text
    .replace(/[\u064B-\u065F\u0670]/g, "") // Remove diacritics
    .replace(/[أإآٱ]/g, "ا") // Normalize alef
    .replace(/ة/g, "ه"); // Ta marbuta -> ha
}

/**
 * Expand text with transliteration variants for indexing
 */
function expandForSearch(text: string): string {
  if (!text) return "";

  const normalizedText = text.toLowerCase();
  const normalizedArabicText = normalizeArabic(normalizedText);
  const expansions: string[] = [];

  for (const [canonical, variants] of Object.entries(MOROCCAN_FOOD_TRANSLITERATIONS)) {
    if (normalizedText.includes(canonical)) {
      expansions.push(...variants);
    }

    for (const variant of variants) {
      const normalizedVariant = normalizeArabic(variant.toLowerCase());
      if (
        normalizedText.includes(variant.toLowerCase()) ||
        normalizedArabicText.includes(normalizedVariant)
      ) {
        if (!expansions.includes(canonical)) {
          expansions.push(canonical);
        }
        for (const v of variants) {
          if (v !== variant && !expansions.includes(v)) {
            expansions.push(v);
          }
        }
        break;
      }
    }
  }

  if (expansions.length > 0) {
    return `${text} ${expansions.join(" ")}`;
  }
  return text;
}

/**
 * Normalize query to canonical form
 */
function normalizeQuery(query: string): string {
  if (!query) return "";

  let normalized = normalizeArabic(query.toLowerCase());
  const words = normalized.split(/\s+/);
  const normalizedWords = words.map((word) => {
    const canonical = VARIANT_TO_CANONICAL.get(word);
    return canonical || word;
  });

  return normalizedWords.join(" ");
}

// ============================================================================
// Searchable Text Builders
// ============================================================================

/**
 * Build searchable text for a curated place
 */
export function buildCuratedPlaceSearchText(place: {
  title: string;
  summary: string;
  mustTry?: string[];
  tags?: string[];
  neighborhood?: string;
}): string {
  const parts = [
    place.title,
    place.summary,
    ...(place.mustTry || []),
    ...(place.tags || []),
    place.neighborhood || "",
  ].filter(Boolean);

  const combined = parts.join(" ");
  return expandForSearch(combined);
}

/**
 * Build searchable text for a guide
 */
export function buildGuideSearchText(guide: {
  title: string;
  description: string;
}): string {
  const combined = `${guide.title} ${guide.description}`;
  return expandForSearch(combined);
}

/**
 * Build searchable text for a review
 */
export function buildReviewSearchText(review: {
  text?: string;
  dishesTried?: string[];
}): string {
  const parts = [review.text || "", ...(review.dishesTried || [])].filter(Boolean);
  const combined = parts.join(" ");
  return expandForSearch(combined);
}

/**
 * Build searchable text for a dish
 */
export function buildDishSearchText(dish: string): string {
  return expandForSearch(dish);
}

// ============================================================================
// Search Queries
// ============================================================================

/**
 * Search owned content (curated places, guides, reviews, dishes)
 *
 * Returns unified search results ranked by relevance.
 */
export const searchOwned = query({
  args: {
    query: v.string(),
    city: v.optional(v.string()),
    locale: v.optional(v.string()),
    limit: v.optional(v.number()),
    includeTypes: v.optional(
      v.array(
        v.union(
          v.literal("curated"),
          v.literal("guide"),
          v.literal("review"),
          v.literal("dish")
        )
      )
    ),
  },
  handler: async (ctx, args) => {
    const normalizedQuery = normalizeQuery(args.query);
    if (!normalizedQuery.trim()) {
      return { results: [], query: args.query, normalizedQuery };
    }

    const limit = args.limit ?? 20;
    const types = args.includeTypes ?? ["curated", "guide", "review", "dish"];

    const results: Array<{
      type: "curated" | "guide" | "review" | "dish";
      id: string;
      title: string;
      subtitle?: string;
      placeKey?: string;
      score: number;
    }> = [];

    // Search curated places
    if (types.includes("curated")) {
      const curatedResults = await ctx.db
        .query("curatedPlaces")
        .withSearchIndex("search_curated", (q) => {
          let search = q.search("searchableText", normalizedQuery);
          if (args.city) {
            search = search.eq("city", args.city);
          }
          if (args.locale) {
            search = search.eq("locale", args.locale);
          }
          return search;
        })
        .take(limit);

      for (const place of curatedResults) {
        // Only include published places
        if (place.publishedAt && place.publishedAt <= Date.now()) {
          results.push({
            type: "curated",
            id: place._id,
            title: place.title,
            subtitle: place.summary.substring(0, 100),
            placeKey: place.placeKey,
            score: 1.0, // Curated places get highest base score
          });
        }
      }
    }

    // Search guides
    if (types.includes("guide")) {
      const guideResults = await ctx.db
        .query("guides")
        .withSearchIndex("search_guides", (q) => {
          let search = q.search("searchableText", normalizedQuery);
          if (args.city) {
            search = search.eq("city", args.city);
          }
          if (args.locale) {
            search = search.eq("locale", args.locale);
          }
          return search;
        })
        .take(limit);

      for (const guide of guideResults) {
        // Only include published guides
        if (guide.publishedAt && guide.publishedAt <= Date.now()) {
          results.push({
            type: "guide",
            id: guide._id,
            title: guide.title,
            subtitle: guide.description.substring(0, 100),
            score: 0.9, // Guides get slightly lower score
          });
        }
      }
    }

    // Search reviews (for dish mentions)
    if (types.includes("review")) {
      const reviewResults = await ctx.db
        .query("reviews")
        .withSearchIndex("search_reviews", (q) =>
          q.search("searchableText", normalizedQuery)
        )
        .take(limit);

      for (const review of reviewResults) {
        // Skip deleted reviews
        if (!review.deletedAt && review.text) {
          results.push({
            type: "review",
            id: review._id,
            title: review.text.substring(0, 60) + (review.text.length > 60 ? "..." : ""),
            placeKey: review.placeKey,
            score: 0.7, // Reviews get lower score
          });
        }
      }
    }

    // Search dish mentions
    if (types.includes("dish")) {
      const dishResults = await ctx.db
        .query("placeDishes")
        .withSearchIndex("search_dishes", (q) =>
          q.search("searchableText", normalizedQuery)
        )
        .take(limit);

      for (const dish of dishResults) {
        results.push({
          type: "dish",
          id: dish._id,
          title: dish.dish,
          subtitle: `${dish.mentionsCount} mentions`,
          placeKey: dish.placeKey,
          score: 0.8, // Dishes get moderate score
        });
      }
    }

    // Sort by score and limit
    results.sort((a, b) => b.score - a.score);
    const limitedResults = results.slice(0, limit);

    return {
      results: limitedResults,
      query: args.query,
      normalizedQuery,
      totalCount: results.length,
    };
  },
});

/**
 * Search curated places only
 */
export const searchCuratedPlaces = query({
  args: {
    query: v.string(),
    city: v.optional(v.string()),
    locale: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const normalizedQuery = normalizeQuery(args.query);
    if (!normalizedQuery.trim()) {
      return [];
    }

    const limit = args.limit ?? 20;

    const results = await ctx.db
      .query("curatedPlaces")
      .withSearchIndex("search_curated", (q) => {
        let search = q.search("searchableText", normalizedQuery);
        if (args.city) {
          search = search.eq("city", args.city);
        }
        if (args.locale) {
          search = search.eq("locale", args.locale);
        }
        return search;
      })
      .take(limit);

    // Filter to published only
    return results.filter((p) => p.publishedAt && p.publishedAt <= Date.now());
  },
});

/**
 * Search guides only
 */
export const searchGuides = query({
  args: {
    query: v.string(),
    city: v.optional(v.string()),
    locale: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const normalizedQuery = normalizeQuery(args.query);
    if (!normalizedQuery.trim()) {
      return [];
    }

    const limit = args.limit ?? 20;

    const results = await ctx.db
      .query("guides")
      .withSearchIndex("search_guides", (q) => {
        let search = q.search("searchableText", normalizedQuery);
        if (args.city) {
          search = search.eq("city", args.city);
        }
        if (args.locale) {
          search = search.eq("locale", args.locale);
        }
        return search;
      })
      .take(limit);

    // Filter to published only
    return results.filter((g) => g.publishedAt && g.publishedAt <= Date.now());
  },
});

/**
 * Find places by dish
 */
export const searchByDish = query({
  args: {
    dish: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const normalizedDish = normalizeQuery(args.dish);
    if (!normalizedDish.trim()) {
      return [];
    }

    const limit = args.limit ?? 20;

    const results = await ctx.db
      .query("placeDishes")
      .withSearchIndex("search_dishes", (q) =>
        q.search("searchableText", normalizedDish)
      )
      .take(limit);

    // Sort by mention count
    return results.sort((a, b) => b.mentionsCount - a.mentionsCount);
  },
});

// ============================================================================
// Index Maintenance Mutations
// ============================================================================

/**
 * Update searchable text for a curated place
 * Called when curated place is created/updated
 */
export const updateCuratedPlaceSearchText = internalMutation({
  args: { id: v.id("curatedPlaces") },
  handler: async (ctx, args) => {
    const place = await ctx.db.get(args.id);
    if (!place) return;

    const searchableText = buildCuratedPlaceSearchText({
      title: place.title,
      summary: place.summary,
      mustTry: place.mustTry,
      tags: place.tags,
      neighborhood: place.neighborhood,
    });

    await ctx.db.patch(args.id, { searchableText });
  },
});

/**
 * Update searchable text for a guide
 */
export const updateGuideSearchText = internalMutation({
  args: { id: v.id("guides") },
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.id);
    if (!guide) return;

    const searchableText = buildGuideSearchText({
      title: guide.title,
      description: guide.description,
    });

    await ctx.db.patch(args.id, { searchableText });
  },
});

/**
 * Update searchable text for a review
 */
export const updateReviewSearchText = internalMutation({
  args: { id: v.id("reviews") },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.id);
    if (!review) return;

    const searchableText = buildReviewSearchText({
      text: review.text,
      dishesTried: review.dishesTried,
    });

    await ctx.db.patch(args.id, { searchableText });
  },
});

/**
 * Update searchable text for a dish
 */
export const updateDishSearchText = internalMutation({
  args: { id: v.id("placeDishes") },
  handler: async (ctx, args) => {
    const dish = await ctx.db.get(args.id);
    if (!dish) return;

    const searchableText = buildDishSearchText(dish.dish);

    await ctx.db.patch(args.id, { searchableText });
  },
});

/**
 * Bulk rebuild search indexes for all content
 * Run this after initial setup or schema changes
 */
export const rebuildAllSearchIndexes = internalMutation({
  handler: async (ctx) => {
    let curatedCount = 0;
    let guideCount = 0;
    let reviewCount = 0;
    let dishCount = 0;

    // Rebuild curated places
    const curatedPlaces = await ctx.db.query("curatedPlaces").collect();
    for (const place of curatedPlaces) {
      const searchableText = buildCuratedPlaceSearchText({
        title: place.title,
        summary: place.summary,
        mustTry: place.mustTry,
        tags: place.tags,
        neighborhood: place.neighborhood,
      });
      await ctx.db.patch(place._id, { searchableText });
      curatedCount++;
    }

    // Rebuild guides
    const guides = await ctx.db.query("guides").collect();
    for (const guide of guides) {
      const searchableText = buildGuideSearchText({
        title: guide.title,
        description: guide.description,
      });
      await ctx.db.patch(guide._id, { searchableText });
      guideCount++;
    }

    // Rebuild reviews
    const reviews = await ctx.db.query("reviews").collect();
    for (const review of reviews) {
      const searchableText = buildReviewSearchText({
        text: review.text,
        dishesTried: review.dishesTried,
      });
      await ctx.db.patch(review._id, { searchableText });
      reviewCount++;
    }

    // Rebuild dishes
    const dishes = await ctx.db.query("placeDishes").collect();
    for (const dish of dishes) {
      const searchableText = buildDishSearchText(dish.dish);
      await ctx.db.patch(dish._id, { searchableText });
      dishCount++;
    }

    return {
      rebuilt: {
        curatedPlaces: curatedCount,
        guides: guideCount,
        reviews: reviewCount,
        dishes: dishCount,
      },
    };
  },
});
