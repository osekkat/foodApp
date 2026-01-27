import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Feature Flags - for service mode management and cost control
 *
 * Default flags:
 * - photos_enabled: true
 * - open_now_enabled: true
 * - provider_search_enabled: true
 * - autocomplete_enabled: true
 */

// Get a feature flag
export const get = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const flag = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();

    return flag?.enabled ?? true; // Default to enabled if not found
  },
});

// Get all feature flags
export const getAll = query({
  handler: async (ctx) => {
    const flags = await ctx.db.query("featureFlags").collect();
    return Object.fromEntries(flags.map((f) => [f.key, f.enabled]));
  },
});

// Set a feature flag
export const set = mutation({
  args: {
    key: v.string(),
    enabled: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        reason: args.reason,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("featureFlags", {
        key: args.key,
        enabled: args.enabled,
        reason: args.reason,
        updatedAt: Date.now(),
      });
    }
  },
});

// Initialize default feature flags
export const initDefaults = mutation({
  handler: async (ctx) => {
    const defaults = [
      { key: "photos_enabled", enabled: true },
      { key: "open_now_enabled", enabled: true },
      { key: "provider_search_enabled", enabled: true },
      { key: "autocomplete_enabled", enabled: true },
      { key: "map_search_enabled", enabled: true },
    ];

    for (const flag of defaults) {
      const existing = await ctx.db
        .query("featureFlags")
        .withIndex("by_key", (q) => q.eq("key", flag.key))
        .first();

      if (!existing) {
        await ctx.db.insert("featureFlags", {
          key: flag.key,
          enabled: flag.enabled,
          updatedAt: Date.now(),
        });
      }
    }

    return { success: true };
  },
});
