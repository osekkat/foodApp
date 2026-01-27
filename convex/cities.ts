import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Cities queries - seed data for Morocco's main cities
 */

// Get all featured cities
export const getFeatured = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("cities")
      .withIndex("by_featured", (q) => q.eq("featured", true))
      .collect();
  },
});

// Get city by slug
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("cities")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
  },
});

// Seed initial cities (run once during setup)
export const seedCities = mutation({
  handler: async (ctx) => {
    const cities = [
      {
        name: "Marrakech",
        nameAr: "مراكش",
        nameFr: "Marrakech",
        slug: "marrakech",
        lat: 31.6295,
        lng: -7.9811,
        defaultZoom: 13,
        boundingBox: {
          north: 31.7295,
          south: 31.5295,
          east: -7.8811,
          west: -8.0811,
        },
        featured: true,
        sortOrder: 1,
      },
      {
        name: "Casablanca",
        nameAr: "الدار البيضاء",
        nameFr: "Casablanca",
        slug: "casablanca",
        lat: 33.5731,
        lng: -7.5898,
        defaultZoom: 12,
        boundingBox: {
          north: 33.6731,
          south: 33.4731,
          east: -7.4898,
          west: -7.6898,
        },
        featured: true,
        sortOrder: 2,
      },
      {
        name: "Rabat",
        nameAr: "الرباط",
        nameFr: "Rabat",
        slug: "rabat",
        lat: 34.0209,
        lng: -6.8416,
        defaultZoom: 13,
        boundingBox: {
          north: 34.1209,
          south: 33.9209,
          east: -6.7416,
          west: -6.9416,
        },
        featured: true,
        sortOrder: 3,
      },
      {
        name: "Tangier",
        nameAr: "طنجة",
        nameFr: "Tanger",
        slug: "tangier",
        lat: 35.7595,
        lng: -5.834,
        defaultZoom: 13,
        boundingBox: {
          north: 35.8595,
          south: 35.6595,
          east: -5.734,
          west: -5.934,
        },
        featured: true,
        sortOrder: 4,
      },
      {
        name: "Fes",
        nameAr: "فاس",
        nameFr: "Fès",
        slug: "fes",
        lat: 34.0181,
        lng: -5.0078,
        defaultZoom: 13,
        boundingBox: {
          north: 34.1181,
          south: 33.9181,
          east: -4.9078,
          west: -5.1078,
        },
        featured: true,
        sortOrder: 5,
      },
    ];

    for (const city of cities) {
      // Check if city already exists
      const existing = await ctx.db
        .query("cities")
        .withIndex("by_slug", (q) => q.eq("slug", city.slug))
        .first();

      if (!existing) {
        await ctx.db.insert("cities", city);
      }
    }

    return { success: true, message: "Cities seeded successfully" };
  },
});
