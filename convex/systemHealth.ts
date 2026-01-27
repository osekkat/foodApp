import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * System Health - track external service health for graceful degradation
 *
 * Services:
 * - google_places: Google Places API
 * - google_maps: Google Maps JavaScript API
 */

// Get health status for a service
export const getServiceHealth = query({
  args: { service: v.string() },
  handler: async (ctx, args) => {
    const health = await ctx.db
      .query("systemHealth")
      .withIndex("by_service", (q) => q.eq("service", args.service))
      .first();

    return {
      healthy: health?.healthy ?? true, // Default to healthy if not found
      lastCheckedAt: health?.lastCheckedAt,
      lastHealthyAt: health?.lastHealthyAt,
    };
  },
});

// Get all service health statuses
export const getAllHealth = query({
  handler: async (ctx) => {
    const services = await ctx.db.query("systemHealth").collect();
    return services;
  },
});

// Update health status for a service
export const setServiceHealth = mutation({
  args: {
    service: v.string(),
    healthy: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("systemHealth")
      .withIndex("by_service", (q) => q.eq("service", args.service))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        healthy: args.healthy,
        lastCheckedAt: now,
        lastHealthyAt: args.healthy ? now : existing.lastHealthyAt,
      });
    } else {
      await ctx.db.insert("systemHealth", {
        service: args.service,
        healthy: args.healthy,
        lastCheckedAt: now,
        lastHealthyAt: args.healthy ? now : undefined,
      });
    }
  },
});

// Initialize default services
export const initDefaults = mutation({
  handler: async (ctx) => {
    const services = ["google_places", "google_maps"];
    const now = Date.now();

    for (const service of services) {
      const existing = await ctx.db
        .query("systemHealth")
        .withIndex("by_service", (q) => q.eq("service", service))
        .first();

      if (!existing) {
        await ctx.db.insert("systemHealth", {
          service,
          healthy: true,
          lastCheckedAt: now,
          lastHealthyAt: now,
        });
      }
    }

    return { success: true };
  },
});
