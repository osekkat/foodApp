/**
 * Alerting System
 *
 * Monitors metrics against configurable thresholds and triggers alerts.
 * Integrates with service mode for auto-mitigation.
 *
 * Alert Thresholds:
 * | Metric | Threshold | Action |
 * |--------|-----------|--------|
 * | Google API error rate | >5% for 5min | Page on-call, enable degraded mode |
 * | Search P95 latency | >2s for 10min | Warning notification |
 * | Daily API cost | >$X (configurable) | Alert + emergency throttling |
 * | Cache hit rate | <50% for 1hr | Investigate |
 * | Review spam flags | >10/hour | Alert moderation team |
 */

import {
  internalMutation,
  internalQuery,
  query,
  mutation,
} from "./_generated/server";
import { v, ConvexError } from "convex/values";

// ============================================================================
// Types
// ============================================================================

export type AlertSeverity = "critical" | "warning" | "info";
export type ThresholdOperator = "gt" | "lt" | "gte" | "lte";

// Default alert thresholds
const DEFAULT_THRESHOLDS = [
  {
    name: "google_api_error_rate",
    metric: "api_error_rate",
    threshold: 0.05, // 5%
    operator: "gt" as const,
    windowMinutes: 5,
    severity: "critical" as const,
    autoMitigate: true,
    mitigationAction: "set_service_mode_2",
  },
  {
    name: "search_p95_latency",
    metric: "search_latency_p95",
    threshold: 2000, // 2 seconds
    operator: "gt" as const,
    windowMinutes: 10,
    severity: "warning" as const,
    autoMitigate: false,
  },
  {
    name: "cache_hit_rate_low",
    metric: "cache_hit_rate",
    threshold: 0.5, // 50%
    operator: "lt" as const,
    windowMinutes: 60,
    severity: "warning" as const,
    autoMitigate: false,
  },
  {
    name: "review_spam_rate",
    metric: "review_spam_flags",
    threshold: 10,
    operator: "gt" as const,
    windowMinutes: 60,
    severity: "warning" as const,
    autoMitigate: false,
  },
];

// ============================================================================
// Metric Queries
// ============================================================================

/**
 * Get average metric value over a time window
 */
export const getMetricAverage = internalQuery({
  args: {
    metricName: v.string(),
    windowMinutes: v.number(),
  },
  handler: async (ctx, { metricName, windowMinutes }) => {
    const cutoff = Date.now() - windowMinutes * 60 * 1000;

    const metrics = await ctx.db
      .query("metrics")
      .withIndex("by_name_time", (q) =>
        q.eq("name", metricName).gt("timestamp", cutoff)
      )
      .collect();

    if (metrics.length === 0) {
      return null;
    }

    const sum = metrics.reduce((acc, m) => acc + m.value, 0);
    return sum / metrics.length;
  },
});

/**
 * Get error rate (errors / total) over a time window
 */
export const getErrorRate = internalQuery({
  args: {
    windowMinutes: v.number(),
  },
  handler: async (ctx, { windowMinutes }) => {
    const cutoff = Date.now() - windowMinutes * 60 * 1000;

    // Get success and error counts
    const successMetrics = await ctx.db
      .query("metrics")
      .withIndex("by_name_time", (q) =>
        q.eq("name", "api_request_success").gt("timestamp", cutoff)
      )
      .collect();

    const errorMetrics = await ctx.db
      .query("metrics")
      .withIndex("by_name_time", (q) =>
        q.eq("name", "api_request_error").gt("timestamp", cutoff)
      )
      .collect();

    const successCount = successMetrics.reduce((acc, m) => acc + m.value, 0);
    const errorCount = errorMetrics.reduce((acc, m) => acc + m.value, 0);
    const total = successCount + errorCount;

    if (total === 0) {
      return null;
    }

    return errorCount / total;
  },
});

/**
 * Get P95 latency over a time window
 */
export const getP95Latency = internalQuery({
  args: {
    metricName: v.string(),
    windowMinutes: v.number(),
  },
  handler: async (ctx, { metricName, windowMinutes }) => {
    const cutoff = Date.now() - windowMinutes * 60 * 1000;

    const metrics = await ctx.db
      .query("metrics")
      .withIndex("by_name_time", (q) =>
        q.eq("name", metricName).gt("timestamp", cutoff)
      )
      .collect();

    if (metrics.length === 0) {
      return null;
    }

    // Sort and get P95: the value at the 95th percentile
    const sorted = metrics.map((m) => m.value).sort((a, b) => a - b);
    const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
    return sorted[p95Index];
  },
});

// ============================================================================
// Alert Checking
// ============================================================================

/**
 * Helper functions for metric queries (inline to avoid type depth issues)
 */
async function getErrorRateInline(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  windowMinutes: number
): Promise<number | null> {
  const cutoff = Date.now() - windowMinutes * 60 * 1000;

  const successMetrics = await ctx.db
    .query("metrics")
    .withIndex("by_name_time", (q: { eq: (arg0: string, arg1: string) => { gt: (arg0: string, arg1: number) => void } }) =>
      q.eq("name", "api_request_success").gt("timestamp", cutoff)
    )
    .collect();

  const errorMetrics = await ctx.db
    .query("metrics")
    .withIndex("by_name_time", (q: { eq: (arg0: string, arg1: string) => { gt: (arg0: string, arg1: number) => void } }) =>
      q.eq("name", "api_request_error").gt("timestamp", cutoff)
    )
    .collect();

  const successCount = successMetrics.reduce((acc: number, m: { value: number }) => acc + m.value, 0);
  const errorCount = errorMetrics.reduce((acc: number, m: { value: number }) => acc + m.value, 0);
  const total = successCount + errorCount;

  return total === 0 ? null : errorCount / total;
}

async function getMetricAverageInline(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  metricName: string,
  windowMinutes: number
): Promise<number | null> {
  const cutoff = Date.now() - windowMinutes * 60 * 1000;

  const metrics = await ctx.db
    .query("metrics")
    .withIndex("by_name_time", (q: { eq: (arg0: string, arg1: string) => { gt: (arg0: string, arg1: number) => void } }) =>
      q.eq("name", metricName).gt("timestamp", cutoff)
    )
    .collect();

  if (metrics.length === 0) return null;

  const sum = metrics.reduce((acc: number, m: { value: number }) => acc + m.value, 0);
  return sum / metrics.length;
}

async function getP95LatencyInline(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  metricName: string,
  windowMinutes: number
): Promise<number | null> {
  const cutoff = Date.now() - windowMinutes * 60 * 1000;

  const metrics = await ctx.db
    .query("metrics")
    .withIndex("by_name_time", (q: { eq: (arg0: string, arg1: string) => { gt: (arg0: string, arg1: number) => void } }) =>
      q.eq("name", metricName).gt("timestamp", cutoff)
    )
    .collect();

  if (metrics.length === 0) return null;

  const sorted = metrics.map((m: { value: number }) => m.value).sort((a: number, b: number) => a - b);
  // P95: the value at the 95th percentile (use ceiling to get conservative estimate)
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[p95Index];
}

/**
 * Check all enabled thresholds and trigger alerts
 * Called by cron every minute
 */
export const checkAlerts = internalMutation({
  handler: async (ctx) => {
    // Get all enabled thresholds
    const thresholds = await ctx.db
      .query("alertThresholds")
      .collect();

    const enabledThresholds = thresholds.filter((t) => t.enabled);

    // If no thresholds configured, use defaults (first run)
    if (enabledThresholds.length === 0) {
      // Seed default thresholds
      for (const threshold of DEFAULT_THRESHOLDS) {
        await ctx.db.insert("alertThresholds", {
          ...threshold,
          enabled: true,
          updatedAt: Date.now(),
        });
      }
      return { seededDefaults: true, checkedCount: 0 };
    }

    let alertsTriggered = 0;

    for (const threshold of enabledThresholds) {
      // Get current metric value based on type (inline to avoid type depth issues)
      let currentValue: number | null = null;

      if (threshold.metric === "api_error_rate") {
        currentValue = await getErrorRateInline(ctx, threshold.windowMinutes);
      } else if (threshold.metric.endsWith("_p95")) {
        const baseName = threshold.metric.replace("_p95", "");
        currentValue = await getP95LatencyInline(ctx, baseName, threshold.windowMinutes);
      } else {
        currentValue = await getMetricAverageInline(ctx, threshold.metric, threshold.windowMinutes);
      }

      // Skip if no data
      if (currentValue === null) {
        continue;
      }

      // Check threshold condition
      const breached = checkThresholdCondition(
        currentValue,
        threshold.threshold,
        threshold.operator
      );

      if (breached) {
        // Check if there's already an unresolved alert for this threshold
        const existingAlert = await ctx.db
          .query("alerts")
          .withIndex("by_threshold", (q) =>
            q.eq("thresholdName", threshold.name)
          )
          .order("desc")
          .first();

        // Don't create duplicate alerts within 5 minutes
        if (
          existingAlert &&
          !existingAlert.resolvedAt &&
          Date.now() - existingAlert.createdAt < 5 * 60 * 1000
        ) {
          continue;
        }

        // Create alert
        await ctx.db.insert("alerts", {
          thresholdName: threshold.name,
          severity: threshold.severity,
          title: `${threshold.name} threshold breached`,
          message: `${threshold.metric} is ${currentValue.toFixed(4)} (threshold: ${threshold.threshold})`,
          metricValue: currentValue,
          threshold: threshold.threshold,
          autoMitigated: false,
          createdAt: Date.now(),
        });

        alertsTriggered++;

        // Auto-mitigate if configured
        if (threshold.autoMitigate && threshold.mitigationAction) {
          await executeMitigationAction(ctx, threshold.mitigationAction);

          // Update alert to show it was auto-mitigated
          const alert = await ctx.db
            .query("alerts")
            .withIndex("by_threshold", (q) =>
              q.eq("thresholdName", threshold.name)
            )
            .order("desc")
            .first();

          if (alert) {
            await ctx.db.patch(alert._id, {
              autoMitigated: true,
              mitigationAction: threshold.mitigationAction,
            });
          }
        }
      } else {
        // Check if there's an unresolved alert that can now be resolved
        const unresolvedAlert = await ctx.db
          .query("alerts")
          .withIndex("by_threshold", (q) =>
            q.eq("thresholdName", threshold.name)
          )
          .order("desc")
          .first();

        if (unresolvedAlert && !unresolvedAlert.resolvedAt) {
          await ctx.db.patch(unresolvedAlert._id, {
            resolvedAt: Date.now(),
          });
        }
      }
    }

    return { checkedCount: enabledThresholds.length, alertsTriggered };
  },
});

function checkThresholdCondition(
  value: number,
  threshold: number,
  operator: string
): boolean {
  switch (operator) {
    case "gt":
      return value > threshold;
    case "lt":
      return value < threshold;
    case "gte":
      return value >= threshold;
    case "lte":
      return value <= threshold;
    default:
      return false;
  }
}

async function executeMitigationAction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  action: string
) {
  // Dynamic import to avoid TypeScript depth issues with complex Convex types
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const internalApi = (require("./_generated/api") as any).internal;
  const setModeRef = internalApi.serviceMode.setMode;

  switch (action) {
    case "set_service_mode_1":
      await ctx.runMutation(setModeRef, { mode: 1, reason: "alert_auto_mitigation" });
      break;
    case "set_service_mode_2":
      await ctx.runMutation(setModeRef, { mode: 2, reason: "alert_auto_mitigation" });
      break;
    case "disable_photos":
      // Disable photos by setting service mode to 1 (Cost-Saver)
      await ctx.runMutation(setModeRef, { mode: 1, reason: "photos_disabled_mitigation" });
      break;
  }
}

// ============================================================================
// Alert Queries (for Admin UI)
// ============================================================================

/**
 * Get recent alerts
 */
export const getRecentAlerts = query({
  args: {
    limit: v.optional(v.number()),
    severity: v.optional(v.string()),
    unresolvedOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, { limit = 50, severity, unresolvedOnly }) => {
    let alerts;

    if (severity) {
      alerts = await ctx.db
        .query("alerts")
        .withIndex("by_severity_recent", (q) => q.eq("severity", severity))
        .order("desc") // Most recent first
        .take(limit);
    } else {
      alerts = await ctx.db
        .query("alerts")
        .order("desc")
        .take(limit);
    }

    if (unresolvedOnly) {
      alerts = alerts.filter((a) => !a.resolvedAt);
    }

    return alerts;
  },
});

/**
 * Get alert statistics
 */
export const getAlertStats = query({
  handler: async (ctx) => {
    const last24h = Date.now() - 24 * 60 * 60 * 1000;
    const lastWeek = Date.now() - 7 * 24 * 60 * 60 * 1000;

    // Use full table scan with filter for time-based queries
    // This is acceptable for a statistics endpoint that isn't called frequently
    const allAlerts = await ctx.db.query("alerts").collect();

    const recentAlerts = allAlerts.filter((a) => a.createdAt > last24h);
    const weeklyAlerts = allAlerts.filter((a) => a.createdAt > lastWeek);
    const unresolvedAlerts = allAlerts.filter((a) => !a.resolvedAt);

    return {
      last24h: {
        total: recentAlerts.length,
        critical: recentAlerts.filter((a) => a.severity === "critical").length,
        warning: recentAlerts.filter((a) => a.severity === "warning").length,
      },
      lastWeek: weeklyAlerts.length,
      unresolved: unresolvedAlerts.length,
    };
  },
});

// ============================================================================
// Threshold Management
// ============================================================================

/**
 * Get all alert thresholds
 */
export const getThresholds = query({
  handler: async (ctx) => {
    return await ctx.db.query("alertThresholds").collect();
  },
});

/**
 * Update an alert threshold
 */
export const updateThreshold = mutation({
  args: {
    name: v.string(),
    threshold: v.optional(v.number()),
    enabled: v.optional(v.boolean()),
    autoMitigate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("alertThresholds")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .first();

    if (!existing) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Threshold not found" });
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.threshold !== undefined) updates.threshold = args.threshold;
    if (args.enabled !== undefined) updates.enabled = args.enabled;
    if (args.autoMitigate !== undefined) updates.autoMitigate = args.autoMitigate;

    await ctx.db.patch(existing._id, updates);
    return { success: true };
  },
});

/**
 * Manually resolve an alert
 */
export const resolveAlert = mutation({
  args: {
    alertId: v.id("alerts"),
  },
  handler: async (ctx, { alertId }) => {
    const alert = await ctx.db.get(alertId);
    if (!alert) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Alert not found" });
    }

    if (alert.resolvedAt) {
      return { success: true, message: "Already resolved" };
    }

    await ctx.db.patch(alertId, { resolvedAt: Date.now() });
    return { success: true };
  },
});
