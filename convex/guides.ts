/**
 * Editorial Guides - Curated Content System
 *
 * Guides are OWNED content that powers:
 * - SEO-friendly pages (/guides/{slug})
 * - Featured content on home page
 * - Degraded mode fallback (owned data only)
 *
 * Examples: "Best Tagine in Marrakech", "Coffee Spots in Casablanca"
 *
 * POLICY: All content is owned. No provider data stored here.
 */

import { query, mutation, internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireRole, logAction, getAuthUser } from "./auth/rbac";
import type { Id, Doc } from "./_generated/dataModel";

// ============================================================================
// Types
// ============================================================================

export type GuideLocale = "ar" | "fr" | "en";

export interface GuideInput {
  title: string;
  slug: string;
  description: string;
  coverImageUrl: string;
  city?: string;
  categorySlug?: string;
  placeKeys: string[];
  authorId?: Id<"users">;
  locale: GuideLocale;
  featured: boolean;
  sortOrder: number;
  publishNow?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Validate slug format (lowercase alphanumeric with hyphens)
 */
function validateSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

/**
 * Build searchable text for a guide
 */
function buildSearchableText(guide: {
  title: string;
  description: string;
  city?: string;
}): string {
  const parts = [guide.title, guide.description];
  if (guide.city) {
    parts.push(guide.city);
  }
  return parts.join(" ").toLowerCase();
}

// ============================================================================
// Public Queries
// ============================================================================

/**
 * Get featured guides for display (home page, city pages)
 */
export const getFeaturedGuides = query({
  args: {
    city: v.optional(v.string()),
    locale: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 6;

    const guides = await ctx.db
      .query("guides")
      .withIndex("by_featured", (q) => q.eq("featured", true))
      .order("asc")
      .collect();

    // Filter by published, city, and locale
    const now = Date.now();
    let filtered = guides.filter((g) => g.publishedAt && g.publishedAt <= now);

    if (args.city) {
      filtered = filtered.filter((g) => g.city === args.city);
    }
    if (args.locale) {
      filtered = filtered.filter((g) => g.locale === args.locale);
    }

    // Results are already sorted by sortOrder from index - just take limit
    return filtered.slice(0, limit);
  },
});

/**
 * Get a guide by slug (public view)
 */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const guide = await ctx.db
      .query("guides")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    // Only return if published
    if (guide && guide.publishedAt && guide.publishedAt <= Date.now()) {
      return guide;
    }

    return null;
  },
});

/**
 * Get a guide by ID (public view)
 */
export const getById = query({
  args: { id: v.id("guides") },
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.id);
    if (!guide) return null;

    // Only return if published
    if (guide.publishedAt && guide.publishedAt <= Date.now()) {
      return guide;
    }

    return null;
  },
});

/**
 * List guides by city (public, published only)
 */
export const listByCity = query({
  args: {
    city: v.string(),
    locale: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    const guides = await ctx.db
      .query("guides")
      .withIndex("by_city", (q) => q.eq("city", args.city))
      .take(limit);

    // Filter by published status and locale
    const now = Date.now();
    let filtered = guides.filter((g) => g.publishedAt && g.publishedAt <= now);

    if (args.locale) {
      filtered = filtered.filter((g) => g.locale === args.locale);
    }

    return filtered;
  },
});

/**
 * List all published guides (paginated)
 */
export const list = query({
  args: {
    locale: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    const guides = await ctx.db.query("guides").take(limit * 2); // Overfetch to handle filtering

    // Filter by published status
    const now = Date.now();
    let filtered = guides.filter((g) => g.publishedAt && g.publishedAt <= now);

    if (args.locale) {
      filtered = filtered.filter((g) => g.locale === args.locale);
    }

    return filtered.slice(0, limit);
  },
});

/**
 * Get places data for a guide
 * Resolves placeKeys to either curated places or minimal place anchors
 */
export const getGuidePlaces = query({
  args: { guideId: v.id("guides") },
  handler: async (ctx, args) => {
    const guide = await ctx.db.get(args.guideId);
    if (!guide) return [];

    // Only return for published guides
    if (!guide.publishedAt || guide.publishedAt > Date.now()) {
      return [];
    }

    const placesData = await Promise.all(
      guide.placeKeys.map(async (placeKey) => {
        // Check if it's a curated place
        if (placeKey.startsWith("c:")) {
          const slug = placeKey.slice(2);
          const curated = await ctx.db
            .query("curatedPlaces")
            .withIndex("by_slug", (q) => q.eq("slug", slug))
            .first();

          if (curated && curated.publishedAt && curated.publishedAt <= Date.now()) {
            return {
              placeKey,
              type: "curated" as const,
              title: curated.title,
              summary: curated.summary,
              mustTry: curated.mustTry,
              priceNote: curated.priceNote,
              neighborhood: curated.neighborhood,
              coverStorageId: curated.coverStorageId,
            };
          }
        }

        // Check for place anchor (has community data)
        const place = await ctx.db
          .query("places")
          .withIndex("by_placeKey", (q) => q.eq("placeKey", placeKey))
          .first();

        if (place) {
          return {
            placeKey,
            type: "provider" as const,
            favoritesCount: place.favoritesCount,
            communityRatingAvg: place.communityRatingAvg,
            communityRatingCount: place.communityRatingCount,
          };
        }

        // Place not found in our database - return minimal info
        return {
          placeKey,
          type: "unknown" as const,
        };
      })
    );

    return placesData;
  },
});

// ============================================================================
// Admin Mutations
// ============================================================================

/**
 * Create a new guide (editor/admin only)
 */
export const create = mutation({
  args: {
    title: v.string(),
    slug: v.string(),
    description: v.string(),
    coverImageUrl: v.string(),
    city: v.optional(v.string()),
    categorySlug: v.optional(v.string()),
    placeKeys: v.array(v.string()),
    locale: v.union(v.literal("ar"), v.literal("fr"), v.literal("en")),
    featured: v.boolean(),
    sortOrder: v.number(),
    publishNow: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin", "editor"]);

    // Validate slug
    if (!validateSlug(args.slug)) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Invalid slug format. Use lowercase letters, numbers, and hyphens.",
      });
    }

    // Check for duplicate slug
    const existing = await ctx.db
      .query("guides")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (existing) {
      throw new ConvexError({
        code: "DUPLICATE",
        message: "A guide with this slug already exists",
      });
    }

    // Build searchable text
    const searchableText = buildSearchableText({
      title: args.title,
      description: args.description,
      city: args.city,
    });

    // Create guide
    const guideId = await ctx.db.insert("guides", {
      title: args.title,
      slug: args.slug,
      description: args.description,
      coverImageUrl: args.coverImageUrl,
      city: args.city,
      categorySlug: args.categorySlug,
      placeKeys: args.placeKeys,
      authorId: user.userId,
      locale: args.locale,
      featured: args.featured,
      sortOrder: args.sortOrder,
      publishedAt: args.publishNow ? Date.now() : undefined,
      searchableText,
    });

    // Log action
    await logAction(ctx, "guide.create", "guide", guideId, {
      title: args.title,
      slug: args.slug,
      published: args.publishNow ?? false,
    });

    return guideId;
  },
});

/**
 * Update a guide (editor/admin only)
 */
export const update = mutation({
  args: {
    id: v.id("guides"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    coverImageUrl: v.optional(v.string()),
    city: v.optional(v.union(v.string(), v.null())),
    categorySlug: v.optional(v.union(v.string(), v.null())),
    placeKeys: v.optional(v.array(v.string())),
    locale: v.optional(v.union(v.literal("ar"), v.literal("fr"), v.literal("en"))),
    featured: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "editor"]);

    const guide = await ctx.db.get(args.id);
    if (!guide) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Guide not found",
      });
    }

    // Build updates object
    const updates: Partial<Doc<"guides">> = {};

    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) updates.description = args.description;
    if (args.coverImageUrl !== undefined) updates.coverImageUrl = args.coverImageUrl;
    if (args.city !== undefined) updates.city = args.city === null ? undefined : args.city;
    if (args.categorySlug !== undefined)
      updates.categorySlug = args.categorySlug === null ? undefined : args.categorySlug;
    if (args.placeKeys !== undefined) updates.placeKeys = args.placeKeys;
    if (args.locale !== undefined) updates.locale = args.locale;
    if (args.featured !== undefined) updates.featured = args.featured;
    if (args.sortOrder !== undefined) updates.sortOrder = args.sortOrder;

    // Rebuild searchable text if relevant fields changed
    if (args.title !== undefined || args.description !== undefined || args.city !== undefined) {
      updates.searchableText = buildSearchableText({
        title: args.title ?? guide.title,
        description: args.description ?? guide.description,
        city: args.city === null ? undefined : (args.city ?? guide.city),
      });
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(args.id, updates);

      // Log action
      await logAction(ctx, "guide.update", "guide", args.id, {
        fields: Object.keys(updates),
      });
    }

    return { success: true };
  },
});

/**
 * Publish or unpublish a guide
 */
export const setPublished = mutation({
  args: {
    id: v.id("guides"),
    published: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "editor"]);

    const guide = await ctx.db.get(args.id);
    if (!guide) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Guide not found",
      });
    }

    await ctx.db.patch(args.id, {
      publishedAt: args.published ? Date.now() : undefined,
    });

    // Log action
    await logAction(ctx, args.published ? "guide.publish" : "guide.unpublish", "guide", args.id, {
      title: guide.title,
    });

    return { success: true, published: args.published };
  },
});

/**
 * Set featured status
 */
export const setFeatured = mutation({
  args: {
    id: v.id("guides"),
    featured: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "editor"]);

    const guide = await ctx.db.get(args.id);
    if (!guide) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Guide not found",
      });
    }

    await ctx.db.patch(args.id, { featured: args.featured });

    return { success: true };
  },
});

/**
 * Reorder places in a guide
 */
export const reorderPlaces = mutation({
  args: {
    id: v.id("guides"),
    placeKeys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin", "editor"]);

    const guide = await ctx.db.get(args.id);
    if (!guide) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Guide not found",
      });
    }

    await ctx.db.patch(args.id, { placeKeys: args.placeKeys });

    return { success: true };
  },
});

/**
 * Delete a guide (admin only - more restrictive)
 */
export const remove = mutation({
  args: { id: v.id("guides") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);

    const guide = await ctx.db.get(args.id);
    if (!guide) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Guide not found",
      });
    }

    // Delete the guide
    await ctx.db.delete(args.id);

    // Log action
    await logAction(ctx, "guide.delete", "guide", args.id, {
      title: guide.title,
      slug: guide.slug,
    });

    return { success: true };
  },
});

// ============================================================================
// Admin Queries
// ============================================================================

/**
 * List all guides for admin (includes drafts)
 * Requires admin or editor role
 */
export const adminList = query({
  args: {
    city: v.optional(v.string()),
    locale: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Verify admin/editor role - if not, return empty array
    const user = await getAuthUser(ctx);
    if (!user) {
      return [];
    }

    const userRole = await ctx.db
      .query("userRoles")
      .withIndex("by_user", (q) => q.eq("userId", user.userId))
      .first();

    if (!userRole || !["admin", "editor"].includes(userRole.role)) {
      return [];
    }

    const limit = args.limit ?? 100;

    let guides;
    if (args.city) {
      guides = await ctx.db
        .query("guides")
        .withIndex("by_city", (q) => q.eq("city", args.city))
        .take(limit);
    } else {
      guides = await ctx.db.query("guides").take(limit);
    }

    if (args.locale) {
      guides = guides.filter((g) => g.locale === args.locale);
    }

    return guides;
  },
});

/**
 * Get guide by slug for admin (includes drafts)
 */
export const adminGetBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    // Verify admin/editor role
    const user = await getAuthUser(ctx);
    if (!user) {
      return null;
    }

    const userRole = await ctx.db
      .query("userRoles")
      .withIndex("by_user", (q) => q.eq("userId", user.userId))
      .first();

    if (!userRole || !["admin", "editor"].includes(userRole.role)) {
      return null;
    }

    return ctx.db
      .query("guides")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
  },
});

/**
 * Get guide stats for admin
 */
export const getStats = query({
  handler: async (ctx) => {
    // Verify admin/editor role
    const user = await getAuthUser(ctx);
    if (!user) {
      return null;
    }

    const userRole = await ctx.db
      .query("userRoles")
      .withIndex("by_user", (q) => q.eq("userId", user.userId))
      .first();

    if (!userRole || !["admin", "editor"].includes(userRole.role)) {
      return null;
    }

    const allGuides = await ctx.db.query("guides").collect();
    const now = Date.now();

    const published = allGuides.filter((g) => g.publishedAt && g.publishedAt <= now);
    const featured = allGuides.filter((g) => g.featured);

    // Group by city
    const byCity: Record<string, number> = {};
    for (const guide of allGuides) {
      if (guide.city) {
        byCity[guide.city] = (byCity[guide.city] ?? 0) + 1;
      }
    }

    // Group by locale
    const byLocale: Record<string, number> = {};
    for (const guide of allGuides) {
      byLocale[guide.locale] = (byLocale[guide.locale] ?? 0) + 1;
    }

    return {
      total: allGuides.length,
      published: published.length,
      drafts: allGuides.length - published.length,
      featured: featured.length,
      byCity,
      byLocale,
    };
  },
});

// ============================================================================
// Internal Mutations (for seeding/migration)
// ============================================================================

/**
 * Update guide image (internal only, for fixing broken images)
 */
export const updateGuideImage = internalMutation({
  args: {
    slug: v.string(),
    coverImageUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const guide = await ctx.db
      .query("guides")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (guide) {
      await ctx.db.patch(guide._id, { coverImageUrl: args.coverImageUrl });
      return guide._id;
    }
    return null;
  },
});

/**
 * Seed a guide (internal only, bypasses auth)
 */
export const seedGuide = internalMutation({
  args: {
    title: v.string(),
    slug: v.string(),
    description: v.string(),
    coverImageUrl: v.string(),
    city: v.optional(v.string()),
    placeKeys: v.array(v.string()),
    locale: v.union(v.literal("ar"), v.literal("fr"), v.literal("en")),
    featured: v.boolean(),
    sortOrder: v.number(),
  },
  handler: async (ctx, args) => {
    // Check if already exists
    const existing = await ctx.db
      .query("guides")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (existing) {
      return existing._id;
    }

    const searchableText = [args.title, args.description, args.city]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return ctx.db.insert("guides", {
      ...args,
      publishedAt: Date.now(),
      searchableText,
    });
  },
});
