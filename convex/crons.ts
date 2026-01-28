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

const crons = cronJobs();

// Work around TypeScript depth limitations with complex Convex types
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const internalRef: any = require("./_generated/api").internal;

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
  internalRef.serviceMode.evaluateServiceMode
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
  internalRef.metrics.cleanupOldMetrics,
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
  internalRef.rateLimit.cleanupExpiredRateLimits
);

/**
 * Alert Checking
 *
 * Runs every minute to check alert thresholds and trigger notifications.
 * Monitors:
 * - Google API error rate (>5% for 5min)
 * - Search P95 latency (>2s for 10min)
 * - Cache hit rate (<50% for 1hr)
 * - Review spam rate (>10/hour)
 *
 * Auto-mitigation triggers service mode changes when configured.
 */
crons.interval(
  "check_alerts",
  { minutes: 1 },
  internalRef.alerts.checkAlerts
);

/**
 * Search Cache Cleanup
 *
 * Runs every hour to delete expired searchResultCache entries.
 * Uses short TTL (15 minutes) so expired entries accumulate quickly.
 */
crons.interval(
  "cleanup_search_cache",
  { hours: 1 },
  internalRef.searchCache.purgeExpiredSearchCache
);

/**
 * Map Tile Cache Cleanup
 *
 * Runs every hour to delete expired mapTileCache entries.
 * Map tile cache uses 45-minute TTL, so expired entries accumulate.
 */
crons.interval(
  "cleanup_tile_cache",
  { hours: 1 },
  internalRef.mapTileCache.purgeExpiredTileCache
);

/**
 * Popular Searches Daily Aggregation
 *
 * Runs daily at 4 AM UTC to aggregate search queries from the last 24 hours.
 * Applies k-anonymity (≥20 users) and PII filtering before storing aggregates.
 * This powers the "Popular Searches" feature while protecting user privacy.
 */
crons.daily(
  "aggregate_popular_searches",
  { hourUTC: 4, minuteUTC: 0 },
  internalRef.popularSearches.runDailyAggregation
);

/**
 * Raw Search Log Cleanup
 *
 * Runs every 6 hours to delete raw search logs older than 24 hours.
 * Privacy requirement: raw per-user queries must not be retained beyond 24h.
 * Aggregated data (with k-anonymity) is retained for 30 days.
 */
crons.interval(
  "cleanup_raw_search_logs",
  { hours: 6 },
  internalRef.popularSearches.purgeOldSearchLogs
);

/**
 * Old Aggregates Cleanup
 *
 * Runs daily at 5 AM UTC to delete search aggregates older than 30 days.
 * Keeps the searchAggregates table size manageable.
 */
crons.daily(
  "cleanup_old_search_aggregates",
  { hourUTC: 5, minuteUTC: 0 },
  internalRef.popularSearches.purgeOldAggregates
);

/**
 * Future cron jobs to implement:
 *
 * Geo Expiry Purge - Delete expired lat/lng from places table
 * crons.daily("geo_expiry_purge", { hourUTC: 3 }, internal.maintenance.purgeExpiredGeo);
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
