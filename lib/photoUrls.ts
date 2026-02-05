/**
 * Photo URL Signing - Generate and verify signed photo URLs for hotlink prevention
 *
 * All photo URLs must be signed to:
 * 1. Prevent hotlinking from external sites
 * 2. Enable URL expiration for cache control
 * 3. Track photo access through legitimate channels only
 */

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
 * Generate HMAC-SHA256 signature using Web Crypto API
 * Compatible with Node.js, Edge Runtime, and Convex
 */
async function hmacSha256(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    enc.encode(message)
  );
  
  // Use Buffer if available (Node/Convex), otherwise fallback to manual base64url
  if (typeof Buffer !== "undefined") {
    return Buffer.from(signature).toString("base64url");
  }
  
  // Fallback for environments without Buffer
  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Constant-time comparison to prevent timing attacks
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
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
export async function generateSignedPhotoUrl(
  placeId: string,
  photoRef: string,
  size: PhotoSize = "medium",
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${placeId}:${photoRef}:${size}:${exp}`;
  const sig = await hmacSha256(getSigningSecret(), payload);

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
export async function verifySignature(
  placeId: string,
  photoRef: string,
  size: string,
  exp: string,
  sig: string
): Promise<{ valid: boolean; reason?: string }> {
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
  const expected = await hmacSha256(getSigningSecret(), payload);

  if (!constantTimeEqual(sig, expected)) {
    return { valid: false, reason: "invalid_signature" };
  }

  return { valid: true };
}

/**
 * Parse photo URLs from Places API response photos array
 *
 * @param photos - Photos array from Places API response
 * @param placeId - The place ID these photos belong to
 * @param size - Desired size for the signed URLs
 * @returns Array of signed photo URLs
 */
export async function parsePhotoReferences(
  photos: Array<{ name: string }>,
  placeId: string,
  size: PhotoSize = "medium"
): Promise<string[]> {
  return Promise.all(photos.map(async (photo) => {
    // Photo name format: places/{placeId}/photos/{photoRef}
    const photoRef = photo.name.split("/").pop() || "";
    return generateSignedPhotoUrl(placeId, photoRef, size);
  }));
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
