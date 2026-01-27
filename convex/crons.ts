/**
 * Scheduled Jobs (Cron) - Periodic system maintenance tasks
 *
 * This module configures scheduled tasks for:
 * - Service mode evaluation (every minute)
 * - Future: cache cleanup, metrics aggregation, etc.
 *
 * IMPORTANT: Cron jobs should be lightweight and fast.
 * Heavy operations should be delegated to actions or batch mutations.
 */

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

/**
 * Service Mode Evaluation
 *
 * Runs every minute to check system health triggers and update service mode:
 * - Provider health (Google Places API status)
 * - Budget usage (daily API call limits)
 * - Latency metrics (P95 response times)
 * - Circuit breaker state
 *
 * The evaluateServiceMode function will:
 * 1. Query all health indicators
 * 2. Determine appropriate service mode (0-3)
 * 3. Update feature flags if mode changes
 * 4. Log transitions for observability
 */
crons.interval(
  "evaluate_service_mode",
  { minutes: 1 },
  // @ts-expect-error - TypeScript depth limit with complex Convex types
  internal.serviceMode.evaluateServiceMode
);

/**
 * Metrics Cleanup
 *
 * Runs daily at 2 AM UTC to delete raw metrics older than 7 days.
 * Keeps data volume manageable while preserving recent data for analysis.
 */
crons.daily(
  "cleanup_old_metrics",
  { hourUTC: 2, minuteUTC: 0 },
  internal.metrics.cleanupOldMetrics,
  {} // No args - uses default 7-day retention
);

/**
 * Rate Limit Cleanup
 *
 * Runs daily at 3 AM UTC to delete expired rate limit records.
 * Records older than the maximum window (24 hours) are removed.
 */
crons.daily(
  "cleanup_expired_rate_limits",
  { hourUTC: 3, minuteUTC: 0 },
  internal.rateLimit.cleanupExpiredRateLimits
);

/**
 * Future cron jobs to implement:
 *
 * Geo Expiry Purge - Delete expired lat/lng from places table
 * crons.daily("geo_expiry_purge", { hourUTC: 3 }, internal.maintenance.purgeExpiredGeo);
 *
 * Cache Cleanup - Delete expired mapTileCache and searchResultCache entries
 * crons.interval("cache_cleanup", { hours: 1 }, internal.maintenance.cleanupExpiredCaches);
 *
 * Aggregates Repair - Recompute favoritesCount, communityRatingAvg/Count
 * crons.daily("aggregates_repair", { hourUTC: 4 }, internal.maintenance.repairAggregates);
 *
 * Budget Watchdog - Check daily budget usage and alert if threshold exceeded
 * crons.interval("budget_watchdog", { minutes: 15 }, internal.maintenance.checkBudgetThresholds);
 *
 * Stale Health Check - Mark services as unhealthy if no recent checks
 * crons.interval("stale_health_check", { minutes: 5 }, internal.maintenance.checkStaleHealth);
 */

export default crons;
