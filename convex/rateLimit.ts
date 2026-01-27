/**
 * Rate Limiting System - Granular per-action limits
 *
 * Implements sliding window rate limiting with different limits for
 * authenticated vs anonymous users. Uses the existing rateLimits table.
 *
 * Rate Limits:
 * | Action | Authenticated | Anonymous |
 * |--------|---------------|-----------|
 * | Search | 60/min | 20/min |
 * | Place detail | 30/min | 30/min |
 * | Review create | 5/hour | N/A |
 * | Photo upload | 10/hour | N/A |
 * | Report submit | 10/day | N/A |
 * | Favorite toggle | 60/min | N/A |
 * | Tag vote | 30/min | 10/min |
 *
 * Usage:
 * ```typescript
 * const limit = await checkRateLimit(ctx, 'search', { userId, ip });
 * if (!limit.allowed) {
 *   throw new ConvexError({ code: 'RATE_LIMITED', ... });
 * }
 * ```
 */

import { internalMutation, internalQuery, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

// ============================================================================
// Types & Configuration
// ============================================================================

/**
 * Rate limit configuration per action
 */
interface RateLimitConfig {
  /** Time window in milliseconds */
  window: number;
  /** Maximum requests per window */
  limit: number;
}

/**
 * Rate limit result returned to callers
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs?: number;
}

/**
 * Rate limits by action and authentication status
 * limit: 0 means action is not allowed for that user type
 */
const RATE_LIMITS: Record<string, { auth: RateLimitConfig; anon: RateLimitConfig }> = {
  // Search operations
  search: {
    auth: { window: 60000, limit: 60 }, // 60/min for authenticated
    anon: { window: 60000, limit: 20 }, // 20/min for anonymous
  },
  autocomplete: {
    auth: { window: 60000, limit: 120 }, // Higher for autocomplete (rapid typing)
    anon: { window: 60000, limit: 40 },
  },
  place_detail: {
    auth: { window: 60000, limit: 30 }, // 30/min
    anon: { window: 60000, limit: 30 }, // Same for anon
  },

  // Write operations (authenticated only)
  review_create: {
    auth: { window: 3600000, limit: 5 }, // 5/hour
    anon: { window: 0, limit: 0 }, // Not allowed
  },
  review_edit: {
    auth: { window: 3600000, limit: 10 }, // 10/hour
    anon: { window: 0, limit: 0 },
  },
  photo_upload: {
    auth: { window: 3600000, limit: 10 }, // 10/hour
    anon: { window: 0, limit: 0 },
  },
  report_submit: {
    auth: { window: 86400000, limit: 10 }, // 10/day
    anon: { window: 0, limit: 0 },
  },

  // User actions
  favorite_toggle: {
    auth: { window: 60000, limit: 60 }, // 60/min
    anon: { window: 0, limit: 0 },
  },
  list_create: {
    auth: { window: 3600000, limit: 20 }, // 20/hour
    anon: { window: 0, limit: 0 },
  },
  list_item_add: {
    auth: { window: 60000, limit: 60 }, // 60/min (bulk add support)
    anon: { window: 0, limit: 0 },
  },

  // Tag voting
  tag_vote: {
    auth: { window: 60000, limit: 30 }, // 30/min
    anon: { window: 60000, limit: 10 }, // 10/min for anonymous
  },

  // Helpful votes
  helpful_vote: {
    auth: { window: 60000, limit: 30 },
    anon: { window: 0, limit: 0 },
  },
};

/**
 * Action names for type safety
 */
export type RateLimitAction = keyof typeof RATE_LIMITS;

// ============================================================================
// Core Rate Limiting Function
// ============================================================================

/**
 * Check if an action is allowed under rate limits
 * This is the main function to use in mutations/actions
 *
 * @param ctx - Convex mutation context
 * @param action - The action being performed (e.g., 'search', 'review_create')
 * @param identifier - User ID for authenticated users, IP for anonymous
 * @returns Rate limit result with allowed status and metadata
 */
export const checkRateLimit = internalMutation({
  args: {
    action: v.string(),
    userId: v.optional(v.string()),
    ip: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<RateLimitResult> => {
    const { action, userId, ip } = args;
    const isAuth = !!userId;
    const config = RATE_LIMITS[action]?.[isAuth ? "auth" : "anon"];

    // Unknown action or action not allowed for this user type
    if (!config || config.limit === 0) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: 0,
        retryAfterMs: undefined,
      };
    }

    // Must have either userId or ip for rate limiting
    if (!userId && !ip) {
      // No identifier provided - allow but don't track (edge case)
      return {
        allowed: true,
        remaining: config.limit,
        resetAt: Date.now() + config.window,
      };
    }

    // Build rate limit key
    const key = userId ? `user:${userId}:${action}` : `ip:${ip}:${action}`;

    const now = Date.now();

    // Get existing rate limit record
    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    // Check if we're in a new window
    if (!existing || existing.windowStart + config.window < now) {
      // New window - create or reset record
      if (existing) {
        // Reset existing record for new window
        await ctx.db.patch(existing._id, {
          windowStart: now,
          count: 1,
        });
      } else {
        // Create new record
        await ctx.db.insert("rateLimits", {
          key,
          windowStart: now,
          count: 1,
        });
      }

      return {
        allowed: true,
        remaining: config.limit - 1,
        resetAt: now + config.window,
      };
    }

    // Check if limit exceeded
    if (existing.count >= config.limit) {
      const resetAt = existing.windowStart + config.window;
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterMs: resetAt - now,
      };
    }

    // Increment counter
    await ctx.db.patch(existing._id, { count: existing.count + 1 });

    return {
      allowed: true,
      remaining: config.limit - existing.count - 1,
      resetAt: existing.windowStart + config.window,
    };
  },
});

/**
 * Get current rate limit status without incrementing
 * Useful for showing remaining quota in UI
 */
export const getRateLimitStatus = internalQuery({
  args: {
    action: v.string(),
    userId: v.optional(v.string()),
    ip: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<RateLimitResult & { limit: number }> => {
    const { action, userId, ip } = args;
    const isAuth = !!userId;
    const config = RATE_LIMITS[action]?.[isAuth ? "auth" : "anon"];

    if (!config || config.limit === 0) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: 0,
        limit: 0,
      };
    }

    // Must have either userId or ip for rate limiting
    if (!userId && !ip) {
      return {
        allowed: true,
        remaining: config.limit,
        resetAt: Date.now() + config.window,
        limit: config.limit,
      };
    }

    const key = userId ? `user:${userId}:${action}` : `ip:${ip}:${action}`;
    const now = Date.now();

    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    // No existing record or window expired
    if (!existing || existing.windowStart + config.window < now) {
      return {
        allowed: true,
        remaining: config.limit,
        resetAt: now + config.window,
        limit: config.limit,
      };
    }

    const remaining = Math.max(0, config.limit - existing.count);
    return {
      allowed: remaining > 0,
      remaining,
      resetAt: existing.windowStart + config.window,
      limit: config.limit,
      retryAfterMs: remaining === 0 ? existing.windowStart + config.window - now : undefined,
    };
  },
});

// ============================================================================
// Helper for Throwing Rate Limit Errors
// ============================================================================

/**
 * Check rate limit and throw ConvexError if exceeded
 * Convenience wrapper for use in mutations/actions
 *
 * Note: This inlines the rate limit logic rather than calling checkRateLimit
 * because Convex mutations cannot directly call other mutations.
 */
export const enforceRateLimit = internalMutation({
  args: {
    action: v.string(),
    userId: v.optional(v.string()),
    ip: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<RateLimitResult> => {
    const { action, userId, ip } = args;
    const isAuth = !!userId;
    const config = RATE_LIMITS[action]?.[isAuth ? "auth" : "anon"];

    // Unknown action or action not allowed for this user type
    if (!config || config.limit === 0) {
      throw new ConvexError({
        code: "RATE_LIMITED",
        message: "This action is not allowed.",
        retryAfterSeconds: 0,
        action,
      });
    }

    // Must have either userId or ip for rate limiting
    if (!userId && !ip) {
      // No identifier provided - allow but don't track (edge case)
      return {
        allowed: true,
        remaining: config.limit,
        resetAt: Date.now() + config.window,
      };
    }

    // Build rate limit key
    const key = userId ? `user:${userId}:${action}` : `ip:${ip}:${action}`;
    const now = Date.now();

    // Get existing rate limit record
    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    // Check if we're in a new window
    if (!existing || existing.windowStart + config.window < now) {
      // New window - create or reset record
      if (existing) {
        await ctx.db.patch(existing._id, {
          windowStart: now,
          count: 1,
        });
      } else {
        await ctx.db.insert("rateLimits", {
          key,
          windowStart: now,
          count: 1,
        });
      }

      return {
        allowed: true,
        remaining: config.limit - 1,
        resetAt: now + config.window,
      };
    }

    // Check if limit exceeded
    if (existing.count >= config.limit) {
      const resetAt = existing.windowStart + config.window;
      const retryAfterMs = resetAt - now;
      const retryAfter = Math.ceil(retryAfterMs / 1000);
      throw new ConvexError({
        code: "RATE_LIMITED",
        message: `Too many requests. Please try again in ${retryAfter} seconds.`,
        retryAfterSeconds: retryAfter,
        action,
      });
    }

    // Increment counter
    await ctx.db.patch(existing._id, { count: existing.count + 1 });

    return {
      allowed: true,
      remaining: config.limit - existing.count - 1,
      resetAt: existing.windowStart + config.window,
    };
  },
});

// ============================================================================
// Admin / Debug Queries
// ============================================================================

/**
 * Get all rate limit records for a user (admin/debug)
 */
export const getUserRateLimits = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const prefix = `user:${args.userId}:`;
    const allRecords = await ctx.db.query("rateLimits").collect();

    // Filter by prefix (since we don't have a prefix index)
    const userRecords = allRecords.filter((r) => r.key.startsWith(prefix));

    const now = Date.now();
    return userRecords.map((r) => {
      const action = r.key.replace(prefix, "");
      const config = RATE_LIMITS[action]?.auth;
      const isExpired = config ? r.windowStart + config.window < now : true;

      return {
        action,
        count: r.count,
        limit: config?.limit ?? 0,
        windowStart: r.windowStart,
        isExpired,
        remaining: isExpired ? config?.limit ?? 0 : Math.max(0, (config?.limit ?? 0) - r.count),
      };
    });
  },
});

/**
 * Get rate limit configuration (for UI display)
 */
export const getRateLimitConfig = query({
  handler: () => {
    // Return a sanitized version of the config
    const config: Record<string, { authenticated: { limit: number; windowMs: number }; anonymous: { limit: number; windowMs: number } }> = {};

    for (const [action, limits] of Object.entries(RATE_LIMITS)) {
      config[action] = {
        authenticated: { limit: limits.auth.limit, windowMs: limits.auth.window },
        anonymous: { limit: limits.anon.limit, windowMs: limits.anon.window },
      };
    }

    return config;
  },
});

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Clean up expired rate limit records
 * Call from a scheduled job to keep the table size manageable
 */
export const cleanupExpiredRateLimits = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const maxWindow = 86400000; // 24 hours (longest window)
    const cutoff = now - maxWindow;

    // Get old records in batches
    const oldRecords = await ctx.db
      .query("rateLimits")
      .filter((q) => q.lt(q.field("windowStart"), cutoff))
      .take(1000);

    for (const record of oldRecords) {
      await ctx.db.delete(record._id);
    }

    return { deleted: oldRecords.length };
  },
});
