/**
 * Singleflight - Request Coalescing Pattern
 *
 * Coalesces identical in-flight requests within the same server instance.
 * When multiple callers request the same data concurrently, only one
 * upstream call is made and the result is shared.
 *
 * Use cases:
 * - 20 users open same place → 1 provider call
 * - Popular restaurant gets mobbed → no stampede
 * - Map pan with concurrent users → reduced API load
 *
 * Limitations:
 * - Works per server instance (not distributed)
 * - Don't coalesce if responses are user-specific
 *
 * For distributed coalescing, use Convex's built-in caching or
 * implement a short-TTL cache layer.
 */

// ============================================================================
// Types
// ============================================================================

export interface SingleflightResult<T> {
  data: T;
  shared: boolean; // true if result was shared from another caller
}

export interface SingleflightStats {
  hits: number;
  misses: number;
  active: number;
}

// ============================================================================
// In-Flight Request Tracking
// ============================================================================

/**
 * Map of in-flight requests: key -> Promise<result>
 * When a request completes (success or failure), it's removed from the map.
 */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Metrics tracking
 */
let hits = 0;
let misses = 0;

// ============================================================================
// Core Singleflight Function
// ============================================================================

/**
 * Execute an async operation with singleflight coalescing.
 *
 * If another caller is already executing the same operation (same key),
 * this call will wait for and share that result instead of making
 * a duplicate request.
 *
 * @param key - Unique key identifying the operation (e.g., "details:ChIJ123:BASIC:en:MA")
 * @param operation - The async function to execute
 * @returns The result, plus a flag indicating if it was shared
 *
 * @example
 * const result = await singleflight(
 *   `details:${placeId}:${fieldSet}:${language}`,
 *   () => fetchPlaceDetails(placeId, fieldSet, language)
 * );
 */
export async function singleflight<T>(
  key: string,
  operation: () => Promise<T>
): Promise<SingleflightResult<T>> {
  // Check if there's already an in-flight request for this key
  const existing = inFlight.get(key);
  if (existing) {
    hits++;
    logSingleflightEvent("hit", key);
    // Wait for and share the existing request's result
    const data = (await existing) as T;
    return { data, shared: true };
  }

  // No existing request - we're the first caller
  misses++;
  logSingleflightEvent("miss", key);

  // Create the promise for this operation
  const promise = operation()
    .then((result) => {
      return result;
    })
    .finally(() => {
      // Always clean up, whether success or failure
      inFlight.delete(key);
    });

  // Register the in-flight promise
  inFlight.set(key, promise);

  // Execute and return
  const data = await promise;
  return { data, shared: false };
}

/**
 * Execute with singleflight but don't expose the shared flag
 * Simpler API when you don't care if the result was shared
 */
export async function singleflightSimple<T>(
  key: string,
  operation: () => Promise<T>
): Promise<T> {
  const result = await singleflight(key, operation);
  return result.data;
}

// ============================================================================
// Key Generation Helpers
// ============================================================================

export interface DetailsKeyParams {
  placeId: string;
  fieldSet: string;
  language: string;
  region: string;
}

export interface SearchKeyParams {
  query: string;
  fieldSet: string;
  language: string;
  region: string;
  // Location bias (optional) - serialize carefully to avoid spurious misses
  locationBias?: {
    lat: number;
    lng: number;
    radiusMeters?: number;
  };
}

export interface PhotoKeyParams {
  photoRef: string;
  maxWidth: number;
  maxHeight: number;
}

export interface AutocompleteKeyParams {
  input: string;
  sessionToken?: string;
  language: string;
  region: string;
  locationBias?: {
    lat: number;
    lng: number;
    radiusMeters?: number;
  };
}

/**
 * Generate key for place details request
 */
export function detailsKey(params: DetailsKeyParams): string {
  return `details:${params.placeId}:${params.fieldSet}:${params.language}:${params.region}`;
}

/**
 * Generate key for text search request
 * Location bias is rounded to reduce key cardinality
 */
export function searchKey(params: SearchKeyParams): string {
  const parts = [
    "search",
    encodeURIComponent(params.query.toLowerCase().trim()),
    params.fieldSet,
    params.language,
    params.region,
  ];

  if (params.locationBias) {
    // Round to 3 decimal places (~100m precision) to improve key reuse
    const lat = Math.round(params.locationBias.lat * 1000) / 1000;
    const lng = Math.round(params.locationBias.lng * 1000) / 1000;
    const radius = params.locationBias.radiusMeters ?? 5000;
    parts.push(`loc:${lat},${lng},${radius}`);
  }

  return parts.join(":");
}

/**
 * Generate key for photo fetch request
 */
export function photoKey(params: PhotoKeyParams): string {
  return `photo:${params.photoRef}:${params.maxWidth}x${params.maxHeight}`;
}

/**
 * Generate key for autocomplete request
 * Note: sessionToken is intentionally NOT included in key
 * because autocomplete requests with different session tokens
 * but same input should still be coalesced
 */
export function autocompleteKey(params: AutocompleteKeyParams): string {
  const parts = [
    "autocomplete",
    encodeURIComponent(params.input.toLowerCase().trim()),
    params.language,
    params.region,
  ];

  if (params.locationBias) {
    const lat = Math.round(params.locationBias.lat * 1000) / 1000;
    const lng = Math.round(params.locationBias.lng * 1000) / 1000;
    const radius = params.locationBias.radiusMeters ?? 5000;
    parts.push(`loc:${lat},${lng},${radius}`);
  }

  return parts.join(":");
}

// ============================================================================
// Metrics & Diagnostics
// ============================================================================

/**
 * Get current singleflight stats
 */
export function getStats(): SingleflightStats {
  return {
    hits,
    misses,
    active: inFlight.size,
  };
}

/**
 * Reset stats (for testing)
 */
export function resetStats(): void {
  hits = 0;
  misses = 0;
}

/**
 * Get hit rate as a percentage
 */
export function getHitRate(): number {
  const total = hits + misses;
  if (total === 0) return 0;
  return (hits / total) * 100;
}

/**
 * Check if a key is currently in flight
 */
export function isInFlight(key: string): boolean {
  return inFlight.has(key);
}

/**
 * Get number of active in-flight requests
 */
export function getActiveCount(): number {
  return inFlight.size;
}

/**
 * Log singleflight events for metrics collection
 * Format: singleflight_metric { type, key_prefix, timestamp }
 */
function logSingleflightEvent(type: "hit" | "miss", key: string): void {
  // Extract key prefix (e.g., "details", "search", "photo") for aggregation
  const keyPrefix = key.split(":")[0];

  const payload = {
    type,
    key_prefix: keyPrefix,
    timestamp: Date.now(),
  };

  console.info("singleflight_metric", JSON.stringify(payload));
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Clear all in-flight requests (for testing only)
 *
 * NOTE: Existing waiters will still receive their results (they hold
 * references to the promises). However, new callers after clearing
 * won't detect those in-flight requests and may create duplicates.
 */
export function _clearInFlight(): void {
  inFlight.clear();
}

/**
 * Get all current in-flight keys (for debugging)
 */
export function _getInFlightKeys(): string[] {
  return Array.from(inFlight.keys());
}
