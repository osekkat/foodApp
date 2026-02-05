/**
 * Curated Places - Editorial Content System
 *
 * Curated places are OWNED content that powers:
 * - SEO-friendly pages (our own title, summary, photos)
 * - Offline/degraded mode fallback
 * - Editorial recommendations
 *
 * Two types:
 * 1. Standalone (placeKey = "c:slug") - No provider backing
 * 2. Linked (placeKey = "c:slug", linkedPlaceKey = "g:xxx") - Overlay on provider
 *
 * POLICY: All content is owned. No provider data stored here.
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// ============================================================================
// Types
// ============================================================================

export type CuratedPlaceLocale = "ar" | "fr" | "en";

export interface CuratedPlaceInput {
  title: string;
  slug: string;
  city: string;
  neighborhood?: string;
  linkedPlaceKey?: string;
  summary: string;
  mustTry?: string[];
  priceNote?: string;
  tags?: string[];
  coverStorageId?: Id<"_storage">;
  locale: CuratedPlaceLocale;
  featured: boolean;
  sortOrder: number;
  publishedAt?: number;
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

function resolveTokenIdentifier(identity: { tokenIdentifier?: string } | null) {
  return identity?.tokenIdentifier ?? null;
}

/**
 * Get authenticated user and check admin/editor role
 * Uses the userRoles table for RBAC
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function requireEditor(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required");
  }
  const tokenIdentifier = resolveTokenIdentifier(identity as { tokenIdentifier?: string } | null);
  if (!tokenIdentifier) {
    throw new Error("Authentication required");
  }

  const user = await ctx.db
    .query("users")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .withIndex("by_token", (q: any) => q.eq("tokenIdentifier", tokenIdentifier))
    .first();

  if (!user) {
    throw new Error("User not found");
  }

  // Check role from userRoles table (admin or editor can manage curated content)
  const userRoles = await ctx.db
    .query("userRoles")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .withIndex("by_user", (q: any) => q.eq("userId", user._id))
    .collect();

  const hasEditorAccess = userRoles.some(
    (r: { role: string }) => r.role === "admin" || r.role === "editor"
  );

  if (!hasEditorAccess) {
    throw new Error("Admin or editor role required");
  }

  return user;
}

// ============================================================================
// Public Queries
// ============================================================================

/**
 * Get featured curated places for a city (for home page)
 */
export const getFeaturedPlaces = query({
  args: {
    city: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;

    const places = await ctx.db
      .query("curatedPlaces")
      .withIndex("by_city_featured", (q) => q.eq("city", args.city).eq("featured", true))
      .order("asc")
      .take(limit);

    // Only return published places
    return places.filter((p) => p.publishedAt && p.publishedAt <= Date.now());
  },
});

/**
 * Get a curated place by slug
 */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const place = await ctx.db
      .query("curatedPlaces")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    // Only return if published (or if admin viewing)
    if (place && place.publishedAt && place.publishedAt <= Date.now()) {
      return place;
    }

    return null;
  },
});

/**
 * Get a curated place by ID
 * Only returns published places for public access
 */
export const getById = query({
  args: { id: v.id("curatedPlaces") },
  handler: async (ctx, args) => {
    const place = await ctx.db.get(args.id);
    if (!place) return null;

    // Only return if published
    if (place.publishedAt && place.publishedAt <= Date.now()) {
      return place;
    }

    return null;
  },
});

/**
 * List curated places for a city (paginated)
 * Always returns only published places - use adminList for drafts
 */
export const listByCity = query({
  args: {
    city: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    const places = await ctx.db
      .query("curatedPlaces")
      .withIndex("by_city_featured", (q) => q.eq("city", args.city))
      .take(limit);

    // Only return published places
    return places.filter((p) => p.publishedAt && p.publishedAt <= Date.now());
  },
});

/**
 * Search curated places by title (simple text match)
 */
export const search = query({
  args: {
    query: v.string(),
    city: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const searchTerm = args.query.toLowerCase();

    // Get all curated places (or filter by city)
    let places;
    const city = args.city;
    if (city) {
      places = await ctx.db
        .query("curatedPlaces")
        .withIndex("by_city_featured", (q) => q.eq("city", city))
        .collect();
    } else {
      places = await ctx.db.query("curatedPlaces").collect();
    }

    // Filter by search term and published status
    const matches = places
      .filter((p) => p.publishedAt && p.publishedAt <= Date.now())
      .filter(
        (p) =>
          p.title.toLowerCase().includes(searchTerm) ||
          p.summary.toLowerCase().includes(searchTerm) ||
          p.mustTry?.some((dish) => dish.toLowerCase().includes(searchTerm))
      )
      .slice(0, limit);

    return matches;
  },
});

// ============================================================================
// Admin Mutations
// ============================================================================

/**
 * Create a new curated place (admin/editor only)
 */
export const create = mutation({
  args: {
    title: v.string(),
    slug: v.string(),
    city: v.string(),
    neighborhood: v.optional(v.string()),
    linkedPlaceKey: v.optional(v.string()),
    summary: v.string(),
    mustTry: v.optional(v.array(v.string())),
    priceNote: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    coverStorageId: v.optional(v.id("_storage")),
    locale: v.union(v.literal("ar"), v.literal("fr"), v.literal("en")),
    featured: v.boolean(),
    sortOrder: v.number(),
    publishNow: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx);

    // Validate slug
    if (!validateSlug(args.slug)) {
      throw new Error("Invalid slug format. Use lowercase letters, numbers, and hyphens.");
    }

    // Check for duplicate slug
    const existing = await ctx.db
      .query("curatedPlaces")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (existing) {
      throw new Error("A curated place with this slug already exists");
    }

    // Generate placeKey
    const placeKey = `c:${args.slug}`;

    // Create curated place
    const curatedPlaceId = await ctx.db.insert("curatedPlaces", {
      title: args.title,
      slug: args.slug,
      city: args.city,
      neighborhood: args.neighborhood,
      placeKey,
      linkedPlaceKey: args.linkedPlaceKey,
      summary: args.summary,
      mustTry: args.mustTry,
      priceNote: args.priceNote,
      tags: args.tags,
      coverStorageId: args.coverStorageId,
      locale: args.locale,
      featured: args.featured,
      sortOrder: args.sortOrder,
      publishedAt: args.publishNow ? Date.now() : undefined,
    });

    // Create places anchor for UGC (reviews, favorites, etc.)
    const existingPlace = await ctx.db
      .query("places")
      .withIndex("by_placeKey", (q) => q.eq("placeKey", placeKey))
      .first();

    if (!existingPlace) {
      await ctx.db.insert("places", {
        placeKey,
        communityRatingCount: 0,
        favoritesCount: 0,
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      });
    }

    return curatedPlaceId;
  },
});

/**
 * Update a curated place (admin/editor only)
 */
export const update = mutation({
  args: {
    id: v.id("curatedPlaces"),
    title: v.optional(v.string()),
    city: v.optional(v.string()),
    neighborhood: v.optional(v.union(v.string(), v.null())),
    linkedPlaceKey: v.optional(v.union(v.string(), v.null())),
    summary: v.optional(v.string()),
    mustTry: v.optional(v.union(v.array(v.string()), v.null())),
    priceNote: v.optional(v.union(v.string(), v.null())),
    tags: v.optional(v.union(v.array(v.string()), v.null())),
    coverStorageId: v.optional(v.union(v.id("_storage"), v.null())),
    locale: v.optional(v.union(v.literal("ar"), v.literal("fr"), v.literal("en"))),
    featured: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx);

    const place = await ctx.db.get(args.id);
    if (!place) {
      throw new Error("Curated place not found");
    }

    // Build updates object
    const updates: Record<string, unknown> = {};

    if (args.title !== undefined) updates.title = args.title;
    if (args.city !== undefined) updates.city = args.city;
    if (args.neighborhood !== undefined) updates.neighborhood = args.neighborhood === null ? undefined : args.neighborhood;
    if (args.linkedPlaceKey !== undefined) updates.linkedPlaceKey = args.linkedPlaceKey === null ? undefined : args.linkedPlaceKey;
    if (args.summary !== undefined) updates.summary = args.summary;
    if (args.mustTry !== undefined) updates.mustTry = args.mustTry === null ? undefined : args.mustTry;
    if (args.priceNote !== undefined) updates.priceNote = args.priceNote === null ? undefined : args.priceNote;
    if (args.tags !== undefined) updates.tags = args.tags === null ? undefined : args.tags;
    if (args.coverStorageId !== undefined) updates.coverStorageId = args.coverStorageId === null ? undefined : args.coverStorageId;
    if (args.locale !== undefined) updates.locale = args.locale;
    if (args.featured !== undefined) updates.featured = args.featured;
    if (args.sortOrder !== undefined) updates.sortOrder = args.sortOrder;

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(args.id, updates);
    }

    return { success: true };
  },
});

/**
 * Publish or unpublish a curated place
 */
export const setPublished = mutation({
  args: {
    id: v.id("curatedPlaces"),
    published: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx);

    const place = await ctx.db.get(args.id);
    if (!place) {
      throw new Error("Curated place not found");
    }

    await ctx.db.patch(args.id, {
      publishedAt: args.published ? Date.now() : undefined,
    });

    return { success: true, published: args.published };
  },
});

/**
 * Set featured status
 */
export const setFeatured = mutation({
  args: {
    id: v.id("curatedPlaces"),
    featured: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireEditor(ctx);

    const place = await ctx.db.get(args.id);
    if (!place) {
      throw new Error("Curated place not found");
    }

    await ctx.db.patch(args.id, { featured: args.featured });

    return { success: true };
  },
});

/**
 * Delete a curated place (admin only - more restrictive)
 */
export const remove = mutation({
  args: { id: v.id("curatedPlaces") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required");
    }
    const tokenIdentifier = resolveTokenIdentifier(identity as { tokenIdentifier?: string } | null);
    if (!tokenIdentifier) {
      throw new Error("Authentication required");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenIdentifier))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    // Check for admin role in userRoles table
    const userRoles = await ctx.db
      .query("userRoles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const isAdmin = userRoles.some((r) => r.role === "admin");
    if (!isAdmin) {
      throw new Error("Admin role required to delete curated places");
    }

    const place = await ctx.db.get(args.id);
    if (!place) {
      throw new Error("Curated place not found");
    }

    // Delete the curated place
    await ctx.db.delete(args.id);

    // Note: We don't delete the places anchor as it may have UGC attached

    return { success: true };
  },
});

// ============================================================================
// Admin Queries
// ============================================================================

/**
 * List all curated places for admin (includes drafts)
 * Requires admin or editor role
 */
export const adminList = query({
  args: {
    city: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Verify admin/editor role
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }
    const tokenIdentifier = resolveTokenIdentifier(identity as { tokenIdentifier?: string } | null);
    if (!tokenIdentifier) {
      return [];
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenIdentifier))
      .first();

    if (!user) {
      return [];
    }

    // Check for admin/editor role in userRoles table
    const userRoles = await ctx.db
      .query("userRoles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const hasEditorAccess = userRoles.some(
      (r) => r.role === "admin" || r.role === "editor"
    );
    if (!hasEditorAccess) {
      return [];
    }

    const limit = args.limit ?? 100;
    const city = args.city;

    if (city) {
      return ctx.db
        .query("curatedPlaces")
        .withIndex("by_city_featured", (q) => q.eq("city", city))
        .take(limit);
    }

    return ctx.db.query("curatedPlaces").take(limit);
  },
});

/**
 * Get curated place stats
 * Requires admin or editor role
 */
export const getStats = query({
  handler: async (ctx) => {
    // Verify admin/editor role
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }
    const tokenIdentifier = resolveTokenIdentifier(identity as { tokenIdentifier?: string } | null);
    if (!tokenIdentifier) {
      return null;
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenIdentifier))
      .first();

    if (!user) {
      return null;
    }

    // Check for admin/editor role in userRoles table
    const userRoles = await ctx.db
      .query("userRoles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const hasEditorAccess = userRoles.some(
      (r) => r.role === "admin" || r.role === "editor"
    );
    if (!hasEditorAccess) {
      return null;
    }

    const allPlaces = await ctx.db.query("curatedPlaces").collect();

    const published = allPlaces.filter((p) => p.publishedAt && p.publishedAt <= Date.now());
    const featured = allPlaces.filter((p) => p.featured);
    const linked = allPlaces.filter((p) => p.linkedPlaceKey);

    // Group by city
    const byCity: Record<string, number> = {};
    for (const place of allPlaces) {
      byCity[place.city] = (byCity[place.city] ?? 0) + 1;
    }

    return {
      total: allPlaces.length,
      published: published.length,
      drafts: allPlaces.length - published.length,
      featured: featured.length,
      linked: linked.length,
      standalone: allPlaces.length - linked.length,
      byCity,
    };
  },
});
