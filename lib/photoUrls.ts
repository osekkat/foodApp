/**
 * Photo URL Signing - Generate and verify signed photo URLs for hotlink prevention
 *
 * All photo URLs must be signed to:
 * 1. Prevent hotlinking from external sites
 * 2. Enable URL expiration for cache control
 * 3. Track photo access through legitimate channels only
 */

import { createHmac, timingSafeEqual } from "crypto";

/**
 * Photo size variants
 */
export type PhotoSize = "thumbnail" | "medium" | "full";

/**
 * Size to maxHeightPx mapping for Google Photos API
 */
export const PHOTO_SIZE_MAP: Record<PhotoSize, number> = {
  thumbnail: 100,
  medium: 400,
  full: 1000,
};

/**
 * Default TTL for signed URLs (15 minutes)
 */
const DEFAULT_TTL_SECONDS = 900;

/**
 * Get the signing secret from environment
 * Falls back to a development-only secret if not set
 */
function getSigningSecret(): string {
  const secret = process.env.PHOTO_SIGNING_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("PHOTO_SIGNING_SECRET must be set in production");
    }
    // Development fallback - NOT secure, just for testing
    return "dev-signing-secret-not-for-production";
  }
  return secret;
}

/**
 * Generate a signed photo URL
 *
 * @param placeId - Google Place ID (e.g., "ChIJ...")
 * @param photoRef - Photo reference from Places API (the photo name suffix)
 * @param size - Desired photo size
 * @param ttlSeconds - URL validity period (default 15 minutes)
 * @returns Signed URL path (relative to domain)
 */
export function generateSignedPhotoUrl(
  placeId: string,
  photoRef: string,
  size: PhotoSize = "medium",
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${placeId}:${photoRef}:${size}:${exp}`;
  const sig = createHmac("sha256", getSigningSecret())
    .update(payload)
    .digest("base64url");

  return `/api/photos/${encodeURIComponent(placeId)}/${encodeURIComponent(photoRef)}?size=${size}&exp=${exp}&sig=${sig}`;
}

/**
 * Verify a signed photo URL signature
 *
 * @param placeId - Google Place ID from URL path
 * @param photoRef - Photo reference from URL path
 * @param size - Size parameter from query string
 * @param exp - Expiration timestamp from query string
 * @param sig - Signature from query string
 * @returns true if signature is valid and not expired
 */
export function verifySignature(
  placeId: string,
  photoRef: string,
  size: string,
  exp: string,
  sig: string
): { valid: boolean; reason?: string } {
  // Check expiration first (cheaper than crypto)
  const expNum = parseInt(exp, 10);
  if (isNaN(expNum)) {
    return { valid: false, reason: "invalid_expiration" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (expNum < now) {
    return { valid: false, reason: "expired" };
  }

  // Verify signature
  const payload = `${placeId}:${photoRef}:${size}:${exp}`;
  const expected = createHmac("sha256", getSigningSecret())
    .update(payload)
    .digest("base64url");

  try {
    const sigBuffer = Buffer.from(sig, "base64url");
    const expectedBuffer = Buffer.from(expected, "base64url");

    // Constant-time comparison to prevent timing attacks
    if (sigBuffer.length !== expectedBuffer.length) {
      return { valid: false, reason: "invalid_signature" };
    }

    if (!timingSafeEqual(sigBuffer, expectedBuffer)) {
      return { valid: false, reason: "invalid_signature" };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: "invalid_signature_format" };
  }
}

/**
 * Parse photo URLs from Places API response photos array
 *
 * @param photos - Photos array from Places API response
 * @param placeId - The place ID these photos belong to
 * @param size - Desired size for the signed URLs
 * @returns Array of signed photo URLs
 */
export function parsePhotoReferences(
  photos: Array<{ name: string }>,
  placeId: string,
  size: PhotoSize = "medium"
): string[] {
  return photos.map((photo) => {
    // Photo name format: places/{placeId}/photos/{photoRef}
    const photoRef = photo.name.split("/").pop() || "";
    return generateSignedPhotoUrl(placeId, photoRef, size);
  });
}

/**
 * Build the Google Places Photo URL for fetching
 *
 * @param placeId - Google Place ID
 * @param photoRef - Photo reference
 * @param maxHeightPx - Maximum height in pixels
 * @param apiKey - Google API key
 * @returns Full Google Photos API URL
 */
export function buildGooglePhotoUrl(
  placeId: string,
  photoRef: string,
  maxHeightPx: number,
  apiKey: string
): string {
  // Google Places API (New) photo URL format
  const photoName = `places/${placeId}/photos/${photoRef}`;
  return `https://places.googleapis.com/v1/${photoName}/media?key=${apiKey}&maxHeightPx=${maxHeightPx}&skipHttpRedirect=true`;
}
