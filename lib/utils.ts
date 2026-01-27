import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Utility function for merging Tailwind CSS classes
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Generate a placeKey from provider type and ID
 * - Google: "g:" + place_id
 * - Curated: "c:" + slug
 */
export function makePlaceKey(
  provider: "google" | "curated",
  id: string
): string {
  const prefix = provider === "google" ? "g" : "c"
  return `${prefix}:${id}`
}

/**
 * Parse a placeKey into provider type and ID
 */
export function parsePlaceKey(placeKey: string): {
  provider: "google" | "curated" | "unknown"
  id: string
} {
  if (placeKey.startsWith("g:")) {
    return { provider: "google", id: placeKey.slice(2) }
  }
  if (placeKey.startsWith("c:")) {
    return { provider: "curated", id: placeKey.slice(2) }
  }
  return { provider: "unknown", id: placeKey }
}

/**
 * Format a price bucket for display
 */
export function formatPriceBucket(bucket: string): string {
  const buckets: Record<string, string> = {
    "<30": "Under 30 MAD",
    "30-70": "30-70 MAD",
    "70-150": "70-150 MAD",
    "150+": "150+ MAD",
  }
  return buckets[bucket] || bucket
}
