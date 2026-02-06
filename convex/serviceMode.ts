/**
 * Service Mode State Machine - Graceful Degradation System
 *
 * Implements a multi-level service mode that progressively degrades features
 * based on system health triggers (provider health, budget, latency, circuit breaker).
 *
 * Mode Levels:
 * - Mode 0 (Normal): Full functionality - all systems healthy and budget ok
 * - Mode 1 (Cost-Saver): Tighter limits, photos disabled - cost or latency spike
 * - Mode 2 (Provider-Limited): Owned search only - provider errors or breaker open
 * - Mode 3 (Offline/Owned): Only owned data - offline or emergency
 *
 * This module integrates with:
 * - providerGateway.ts (circuit breaker state, budget checks)
 * - systemHealth.ts (provider health status)
 * - featureFlags.ts (feature toggle management)
 */

import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { DAILY_BUDGET_LIMITS, type EndpointClass } from "./fieldSets";

// ============================================================================
// Types & Configuration
// ============================================================================

/**
 * Service mode levels
 */
export type ServiceModeLevel = 0 | 1 | 2 | 3;

/**
 * Service mode state stored in systemState table
 */
export interface ServiceModeState {
  currentMode: ServiceModeLevel;
  reason: string;
  enteredAt: number;
  triggers: {
    providerHealthy: boolean;
    budgetOk: boolean;
    latencyOk: boolean;
    circuitBreakerClosed: boolean;
  };
}

/**
 * Feature flags for each mode level
 * When transitioning modes, these flags are updated
 */
const MODE_FEATURES: Record<ServiceModeLevel, Record<string, boolean>> = {
  0: {
    photos_enabled: true,
    open_now_enabled: true,
    provider_search_enabled: true,
    autocomplete_enabled: true,
    map_search_enabled: true,
  },
  1: {
    photos_enabled: false,
    open_now_enabled: false,
    provider_search_enabled: true,
    autocomplete_enabled: true,
    map_search_enabled: true,
  },
  2: {
    photos_enabled: false,
    open_now_enabled: false,
    provider_search_enabled: false,
    autocomplete_enabled: false,
    map_search_enabled: false,
  },
  3: {
    photos_enabled: false,
    open_now_enabled: false,
    provider_search_enabled: false,
    autocomplete_enabled: false,
    map_search_enabled: false,
  },
};

/**
 * Mode transition reasons for logging/debugging
 */
const MODE_REASONS = {
  normal: "all_systems_nominal",
  costSpike: "budget_threshold_exceeded",
  latencySpike: "latency_threshold_exceeded",
  providerUnhealthy: "provider_unhealthy",
  circuitBreakerOpen: "circuit_breaker_open",
  offline: "offline_mode",
  emergency: "emergency_mode",
} as const;

/**
 * Budget warning threshold (percentage) to trigger Cost-Saver mode
 */
const BUDGET_WARNING_THRESHOLD = 80;

/**
 * Endpoint classes included in service-mode budget health evaluation.
 */
const BUDGET_HEALTH_ENDPOINTS: EndpointClass[] = [
  "place_details",
  "text_search",
  "autocomplete",
  "photos",
];

// ============================================================================
// Public Queries
// ============================================================================

/**
 * Get current service mode state
 * Returns mode 0 (Normal) if not initialized
 */
export const getServiceMode = query({
  handler: async (ctx): Promise<ServiceModeState> => {
    const state = await ctx.db
      .query("systemState")
      .withIndex("by_key", (q) => q.eq("key", "service_mode"))
      .first();

    if (!state) {
      // Default to normal mode if not initialized
      return {
        currentMode: 0,
        reason: MODE_REASONS.normal,
        enteredAt: Date.now(),
        triggers: {
          providerHealthy: true,
          budgetOk: true,
          latencyOk: true,
          circuitBreakerClosed: true,
        },
      };
    }

    return {
      currentMode: state.currentMode as ServiceModeLevel,
      reason: state.reason,
      enteredAt: state.enteredAt,
      triggers: state.triggers,
    };
  },
});

/**
 * Get service mode history for debugging
 */
export const getServiceModeHistory = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const history = await ctx.db
      .query("serviceModeHistory")
      .withIndex("by_recent")
      .order("desc")
      .take(limit);

    return history;
  },
});

// ============================================================================
// Internal Queries (used by evaluateServiceMode)
// ============================================================================

/**
 * Get budget status across all endpoint classes
 * Returns true if all budgets are under warning threshold
 */
export const checkBudgetHealth = internalQuery({
  handler: async (ctx): Promise<{ ok: boolean; warningLevel?: string }> => {
    // Check budget for main endpoint classes
    let worstUsage = 0;

    for (const endpointClass of BUDGET_HEALTH_ENDPOINTS) {
      const todayKey = `budget:${endpointClass}:${new Date().toISOString().split("T")[0]}`;
      const usage = await ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", todayKey))
        .first();

      if (usage) {
        const limit = DAILY_BUDGET_LIMITS[endpointClass] ?? 1000;
        const usagePercent = (usage.count / limit) * 100;
        worstUsage = Math.max(worstUsage, usagePercent);
      }
    }

    return {
      ok: worstUsage < BUDGET_WARNING_THRESHOLD,
      warningLevel: worstUsage >= 95 ? "critical" : worstUsage >= BUDGET_WARNING_THRESHOLD ? "warning" : undefined,
    };
  },
});

/**
 * Get latency health (simplified - in production would track P95 latency)
 * Returns true if latency is acceptable
 */
export const checkLatencyHealth = internalQuery({
  handler: async (): Promise<{ ok: boolean }> => {
    // In a full implementation, this would query a latency metrics table
    // For now, we assume latency is OK unless we implement actual metrics
    // The circuit breaker + budget checks cover most failure scenarios
    return { ok: true };
  },
});

// ============================================================================
// Mode Evaluation & Transition
// ============================================================================

// Budget health check is done inline in evaluateServiceMode to avoid type issues

/**
 * Evaluate and update service mode based on current system state
 * This is the core state machine logic - called periodically by cron
 */
export const evaluateServiceMode = internalMutation({
  handler: async (ctx): Promise<{
    previousMode: ServiceModeLevel;
    currentMode: ServiceModeLevel;
    transitioned: boolean;
    reason: string;
    triggers: {
      providerHealthy: boolean;
      budgetOk: boolean;
      latencyOk: boolean;
      circuitBreakerClosed: boolean;
    };
  }> => {
    const now = Date.now();

    // 1. Gather trigger states
    // Get provider health
    const providerHealth = await ctx.db
      .query("systemHealth")
      .withIndex("by_service", (q) => q.eq("service", "google_places"))
      .first();
    const providerHealthy = providerHealth?.healthy ?? true;

    // Get circuit breaker state (check if healthy - if unhealthy, breaker is open)
    const circuitBreakerClosed = providerHealthy;

    // Get budget health
    let worstUsage = 0;
    for (const endpointClass of BUDGET_HEALTH_ENDPOINTS) {
      const todayKey = `budget:${endpointClass}:${new Date().toISOString().split("T")[0]}`;
      const usage = await ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", todayKey))
        .first();
      if (usage) {
        const limit = DAILY_BUDGET_LIMITS[endpointClass] ?? 1000;
        const usagePercent = (usage.count / limit) * 100;
        worstUsage = Math.max(worstUsage, usagePercent);
      }
    }
    const budgetOk = worstUsage < BUDGET_WARNING_THRESHOLD;

    // Latency health (simplified - always OK for now)
    const latencyOk = true;

    // 2. Determine target mode based on triggers
    let targetMode: ServiceModeLevel;
    let reason: string;

    if (!providerHealthy || !circuitBreakerClosed) {
      // Provider issues -> Mode 2 (Provider-Limited)
      targetMode = 2;
      reason = !providerHealthy ? MODE_REASONS.providerUnhealthy : MODE_REASONS.circuitBreakerOpen;
    } else if (!budgetOk || !latencyOk) {
      // Budget or latency issues -> Mode 1 (Cost-Saver)
      targetMode = 1;
      reason = !budgetOk ? MODE_REASONS.costSpike : MODE_REASONS.latencySpike;
    } else {
      // All systems nominal -> Mode 0 (Normal)
      targetMode = 0;
      reason = MODE_REASONS.normal;
    }

    // 3. Get current state
    const currentState = await ctx.db
      .query("systemState")
      .withIndex("by_key", (q) => q.eq("key", "service_mode"))
      .first();

    const currentMode = (currentState?.currentMode ?? 0) as ServiceModeLevel;
    const triggers: {
      providerHealthy: boolean;
      budgetOk: boolean;
      latencyOk: boolean;
      circuitBreakerClosed: boolean;
    } = {
      providerHealthy,
      budgetOk,
      latencyOk,
      circuitBreakerClosed,
    };

    // 4. Check if mode transition needed
    if (currentMode !== targetMode) {
      // Log mode transition
      await ctx.db.insert("serviceModeHistory", {
        fromMode: currentMode,
        toMode: targetMode,
        reason,
        triggers,
        transitionedAt: now,
      });

      // Update feature flags for new mode
      const newFeatures = MODE_FEATURES[targetMode];
      for (const [key, enabled] of Object.entries(newFeatures)) {
        const existingFlag = await ctx.db
          .query("featureFlags")
          .withIndex("by_key", (q) => q.eq("key", key))
          .first();

        if (existingFlag) {
          await ctx.db.patch(existingFlag._id, {
            enabled,
            reason: `service_mode_${targetMode}_${reason}`,
            updatedAt: now,
          });
        } else {
          await ctx.db.insert("featureFlags", {
            key,
            enabled,
            reason: `service_mode_${targetMode}_${reason}`,
            updatedAt: now,
          });
        }
      }

      // Log transition for observability (safe metadata only)
      console.info(
        "service_mode_transition",
        JSON.stringify({
          from: currentMode,
          to: targetMode,
          reason,
          triggers,
          timestamp: now,
        })
      );
    }

    // 5. Update or create system state
    if (currentState) {
      await ctx.db.patch(currentState._id, {
        currentMode: targetMode,
        reason,
        enteredAt: currentMode !== targetMode ? now : currentState.enteredAt,
        triggers,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("systemState", {
        key: "service_mode",
        currentMode: targetMode,
        reason,
        enteredAt: now,
        triggers,
        updatedAt: now,
      });
    }

    return {
      previousMode: currentMode,
      currentMode: targetMode,
      transitioned: currentMode !== targetMode,
      reason,
      triggers,
    };
  },
});

// ============================================================================
// Manual Mode Control (for emergencies/testing)
// ============================================================================

/**
 * Manually set service mode (admin only - should check RBAC in production)
 * Use for emergencies or testing
 */
export const setServiceMode = mutation({
  args: {
    mode: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate mode is an integer 0-3
    if (!Number.isInteger(args.mode) || args.mode < 0 || args.mode > 3) {
      throw new Error(`Invalid mode: ${args.mode}. Must be an integer 0-3.`);
    }
    const mode = args.mode as ServiceModeLevel;

    const now = Date.now();

    // Get current state
    const currentState = await ctx.db
      .query("systemState")
      .withIndex("by_key", (q) => q.eq("key", "service_mode"))
      .first();

    const currentMode = (currentState?.currentMode ?? 0) as ServiceModeLevel;

    // Record transition if mode changed
    if (currentMode !== mode) {
      const triggers = {
        providerHealthy: mode < 2,
        budgetOk: mode < 1,
        latencyOk: mode < 1,
        circuitBreakerClosed: mode < 2,
      };

      await ctx.db.insert("serviceModeHistory", {
        fromMode: currentMode,
        toMode: mode,
        reason: `manual_${args.reason}`,
        triggers,
        transitionedAt: now,
      });

      // Update feature flags
      const newFeatures = MODE_FEATURES[mode];
      for (const [key, enabled] of Object.entries(newFeatures)) {
        const existingFlag = await ctx.db
          .query("featureFlags")
          .withIndex("by_key", (q) => q.eq("key", key))
          .first();

        if (existingFlag) {
          await ctx.db.patch(existingFlag._id, {
            enabled,
            reason: `manual_mode_${mode}_${args.reason}`,
            updatedAt: now,
          });
        } else {
          await ctx.db.insert("featureFlags", {
            key,
            enabled,
            reason: `manual_mode_${mode}_${args.reason}`,
            updatedAt: now,
          });
        }
      }
    }

    // Update or create state
    if (currentState) {
      await ctx.db.patch(currentState._id, {
        currentMode: mode,
        reason: `manual_${args.reason}`,
        enteredAt: currentMode !== mode ? now : currentState.enteredAt,
        triggers: {
          providerHealthy: mode < 2,
          budgetOk: mode < 1,
          latencyOk: mode < 1,
          circuitBreakerClosed: mode < 2,
        },
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("systemState", {
        key: "service_mode",
        currentMode: mode,
        reason: `manual_${args.reason}`,
        enteredAt: now,
        triggers: {
          providerHealthy: mode < 2,
          budgetOk: mode < 1,
          latencyOk: mode < 1,
          circuitBreakerClosed: mode < 2,
        },
        updatedAt: now,
      });
    }

    return { success: true, mode, reason: args.reason };
  },
});

/**
 * Internal setMode for automated systems (alerts, crons)
 * Bypasses auth checks since it's called by internal functions
 */
export const setMode = internalMutation({
  args: {
    mode: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Validate mode is an integer 0-3
    if (!Number.isInteger(args.mode) || args.mode < 0 || args.mode > 3) {
      throw new Error(`Invalid mode: ${args.mode}. Must be an integer 0-3.`);
    }
    const mode = args.mode as ServiceModeLevel;
    const reason = args.reason ?? `auto_mitigation_mode_${mode}`;

    const now = Date.now();

    // Get current state
    const currentState = await ctx.db
      .query("systemState")
      .withIndex("by_key", (q) => q.eq("key", "service_mode"))
      .first();

    const currentMode = (currentState?.currentMode ?? 0) as ServiceModeLevel;

    // Record transition if mode changed
    if (currentMode !== mode) {
      const triggers = {
        providerHealthy: mode < 2,
        budgetOk: mode < 1,
        latencyOk: mode < 1,
        circuitBreakerClosed: mode < 2,
      };

      await ctx.db.insert("serviceModeHistory", {
        fromMode: currentMode,
        toMode: mode,
        reason,
        triggers,
        transitionedAt: now,
      });

      // Update feature flags
      const newFeatures = MODE_FEATURES[mode];
      for (const [key, enabled] of Object.entries(newFeatures)) {
        const existingFlag = await ctx.db
          .query("featureFlags")
          .withIndex("by_key", (q) => q.eq("key", key))
          .first();

        if (existingFlag) {
          await ctx.db.patch(existingFlag._id, {
            enabled,
            reason: `auto_mode_${mode}_${reason}`,
            updatedAt: now,
          });
        } else {
          await ctx.db.insert("featureFlags", {
            key,
            enabled,
            reason: `auto_mode_${mode}_${reason}`,
            updatedAt: now,
          });
        }
      }
    }

    // Update or create state
    if (currentState) {
      await ctx.db.patch(currentState._id, {
        currentMode: mode,
        reason,
        enteredAt: currentMode !== mode ? now : currentState.enteredAt,
        triggers: {
          providerHealthy: mode < 2,
          budgetOk: mode < 1,
          latencyOk: mode < 1,
          circuitBreakerClosed: mode < 2,
        },
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("systemState", {
        key: "service_mode",
        currentMode: mode,
        reason,
        enteredAt: now,
        triggers: {
          providerHealthy: mode < 2,
          budgetOk: mode < 1,
          latencyOk: mode < 1,
          circuitBreakerClosed: mode < 2,
        },
        updatedAt: now,
      });
    }

    return { success: true, mode, reason };
  },
});

/**
 * Initialize service mode to Mode 0 (Normal)
 * Call once on app initialization
 */
export const initServiceMode = mutation({
  handler: async (ctx) => {
    const now = Date.now();

    const existing = await ctx.db
      .query("systemState")
      .withIndex("by_key", (q) => q.eq("key", "service_mode"))
      .first();

    if (existing) {
      return { success: true, message: "Service mode already initialized" };
    }

    // Initialize to Mode 0 (Normal)
    await ctx.db.insert("systemState", {
      key: "service_mode",
      currentMode: 0,
      reason: MODE_REASONS.normal,
      enteredAt: now,
      triggers: {
        providerHealthy: true,
        budgetOk: true,
        latencyOk: true,
        circuitBreakerClosed: true,
      },
      updatedAt: now,
    });

    // Initialize feature flags for Mode 0
    const features = MODE_FEATURES[0];
    for (const [key, enabled] of Object.entries(features)) {
      const existingFlag = await ctx.db
        .query("featureFlags")
        .withIndex("by_key", (q) => q.eq("key", key))
        .first();

      if (!existingFlag) {
        await ctx.db.insert("featureFlags", {
          key,
          enabled,
          reason: "service_mode_init",
          updatedAt: now,
        });
      }
    }

    return { success: true, message: "Service mode initialized to Mode 0 (Normal)" };
  },
});
