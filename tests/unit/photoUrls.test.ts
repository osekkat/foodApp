import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Mock environment variable before importing
const originalEnv = process.env.PHOTO_SIGNING_SECRET;

describe("photoUrls", () => {
  beforeAll(() => {
    process.env.PHOTO_SIGNING_SECRET = "test-secret-key-for-signing";
  });

  afterAll(() => {
    if (originalEnv) {
      process.env.PHOTO_SIGNING_SECRET = originalEnv;
    } else {
      delete process.env.PHOTO_SIGNING_SECRET;
    }
  });

  describe("PHOTO_SIZE_MAP", () => {
    it("should have correct size mappings", async () => {
      const { PHOTO_SIZE_MAP } = await import("@/lib/photoUrls");
      expect(PHOTO_SIZE_MAP.thumbnail).toBe(100);
      expect(PHOTO_SIZE_MAP.medium).toBe(400);
      expect(PHOTO_SIZE_MAP.full).toBe(1000);
    });
  });

  describe("generateSignedPhotoUrl", () => {
    it("should generate a signed URL with correct format", async () => {
      const { generateSignedPhotoUrl } = await import("@/lib/photoUrls");

      const url = await generateSignedPhotoUrl(
        "test-place-id",
        "test-photo-ref",
        "medium",
        900
      );

      expect(url).toMatch(/^\/api\/photos\//);
      expect(url).toContain("test-place-id");
      expect(url).toContain("test-photo-ref");
      expect(url).toContain("size=medium");
      expect(url).toContain("exp=");
      expect(url).toContain("sig=");
    });

    it("should default to medium size", async () => {
      const { generateSignedPhotoUrl } = await import("@/lib/photoUrls");

      const url = await generateSignedPhotoUrl("place", "photo");
      expect(url).toContain("size=medium");
    });
  });

  describe("verifySignature", () => {
    it("should verify a valid signature", async () => {
      const { generateSignedPhotoUrl, verifySignature } = await import(
        "@/lib/photoUrls"
      );

      const url = await generateSignedPhotoUrl(
        "test-place",
        "test-photo",
        "medium",
        3600
      );

      // Parse the URL to extract params
      const urlObj = new URL(url, "http://localhost");
      const params = urlObj.searchParams;
      const pathParts = urlObj.pathname.split("/");
      const placeId = decodeURIComponent(pathParts[3]);
      const photoRef = decodeURIComponent(pathParts[4]);

      const result = await verifySignature(
        placeId,
        photoRef,
        params.get("size")!,
        params.get("exp")!,
        params.get("sig")!
      );

      expect(result.valid).toBe(true);
    });

    it("should reject an invalid signature", async () => {
      const { verifySignature } = await import("@/lib/photoUrls");

      const result = await verifySignature(
        "place",
        "photo",
        "medium",
        String(Math.floor(Date.now() / 1000) + 3600),
        "invalid-signature"
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("invalid_signature");
    });

    it("should reject an expired signature", async () => {
      const { verifySignature } = await import("@/lib/photoUrls");

      const expiredTimestamp = String(Math.floor(Date.now() / 1000) - 100);
      const result = await verifySignature(
        "place",
        "photo",
        "medium",
        expiredTimestamp,
        "some-signature"
      );

      expect(result.valid).toBe(false);
      expect(result.reason).toBe("expired");
    });
  });

  describe("buildGooglePhotoUrl", () => {
    it("should build correct Google Photos API URL", async () => {
      const { buildGooglePhotoUrl } = await import("@/lib/photoUrls");

      const url = buildGooglePhotoUrl(
        "test-place-id",
        "test-photo-ref",
        400,
        "test-api-key"
      );

      expect(url).toContain("places.googleapis.com");
      expect(url).toContain("test-place-id");
      expect(url).toContain("test-photo-ref");
      expect(url).toContain("maxHeightPx=400");
      expect(url).toContain("key=test-api-key");
      expect(url).toContain("skipHttpRedirect=true");
    });
  });
});
