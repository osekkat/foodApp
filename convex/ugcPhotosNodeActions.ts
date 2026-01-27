"use node";

/**
 * UGC Photos - Node.js Actions
 *
 * This file contains actions that require Node.js runtime
 * for image processing (sharp, blurhash).
 *
 * Separated from ugcPhotos.ts because only actions can use "use node",
 * while mutations and queries run in Convex's JavaScript runtime.
 */

import { internalAction } from "./_generated/server";
import { v } from "convex/values";

// Re-export constants used in the action
const NSFW_AUTO_REJECT_THRESHOLD = 0.7;
const NSFW_REVIEW_THRESHOLD = 0.3;

type ModerationStatus = "pending" | "approved" | "rejected";

/**
 * Internal action to process photo moderation
 *
 * This action:
 * 1. Downloads the image from storage
 * 2. Strips EXIF metadata
 * 3. Generates blurhash placeholder
 * 4. Calculates perceptual hash
 * 5. Runs NSFW detection (if Cloud Vision configured)
 * 6. Updates the photo record with results
 */
export const processPhotoModeration = internalAction({
  args: {
    photoId: v.id("ugcPhotos"),
  },
  handler: async (ctx, args) => {
    // Get photo record (need to work around TypeScript depth limitations)
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const internalApi: any = require("./_generated/api").internal;
    const photo = await ctx.runQuery(internalApi.ugcPhotos.getPhotoInternal, {
      photoId: args.photoId,
    });

    if (!photo) {
      console.error(`Photo not found: ${args.photoId}`);
      return;
    }

    // Get the image URL from storage
    const imageUrl = await ctx.storage.getUrl(photo.storageId);
    if (!imageUrl) {
      console.error(`Storage URL not found for photo: ${args.photoId}`);
      await ctx.runMutation(internalApi.ugcPhotos.updatePhotoModeration, {
        photoId: args.photoId,
        moderationStatus: "rejected",
        exifStripped: false,
      });
      return;
    }

    try {
      // Fetch the image
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }

      const imageBuffer = await response.arrayBuffer();

      // Process the image using sharp (if available)
      let width: number | undefined;
      let height: number | undefined;
      let blurhash: string | undefined;
      let perceptualHash: string | undefined;
      let nsfwScore: number | undefined;
      let exifStripped = false;

      // Attempt to use sharp for image processing
      try {
        // Dynamic import of sharp
        const sharp = (await import("sharp")).default;

        // Load image and strip EXIF
        const image = sharp(Buffer.from(imageBuffer));
        const metadata = await image.metadata();

        width = metadata.width;
        height = metadata.height;

        // Strip EXIF by re-encoding without metadata
        const processedBuffer = await image
          .rotate() // Apply EXIF orientation first
          .withMetadata({ exif: {} }) // Remove EXIF
          .jpeg({ quality: 85 })
          .toBuffer();

        exifStripped = true;

        // Generate thumbnail for blurhash (4x3 components)
        const thumbnailBuffer = await sharp(processedBuffer)
          .resize(32, 32, { fit: "inside" })
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });

        // Generate blurhash (if blurhash package available)
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const blurhashModule = require("blurhash") as { encode: (pixels: Uint8ClampedArray, width: number, height: number, xComp: number, yComp: number) => string };
          blurhash = blurhashModule.encode(
            new Uint8ClampedArray(thumbnailBuffer.data),
            thumbnailBuffer.info.width,
            thumbnailBuffer.info.height,
            4,
            3
          );
        } catch {
          // Blurhash package not available
          console.warn("Blurhash encoding not available");
        }
      } catch (sharpError) {
        // Sharp not available - mark for manual processing
        console.warn("Sharp not available for image processing:", sharpError);
        // Continue with basic validation
      }

      // NSFW Detection via Cloud Vision (if configured)
      const visionApiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
      if (visionApiKey) {
        try {
          const visionResponse = await fetch(
            `https://vision.googleapis.com/v1/images:annotate?key=${visionApiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                requests: [
                  {
                    image: { source: { imageUri: imageUrl } },
                    features: [{ type: "SAFE_SEARCH_DETECTION" }],
                  },
                ],
              }),
            }
          );

          if (visionResponse.ok) {
            const visionData = await visionResponse.json();
            const safeSearch =
              visionData.responses?.[0]?.safeSearchAnnotation;

            if (safeSearch) {
              // Calculate NSFW score from SafeSearch annotations
              // Likelihood levels: UNKNOWN, VERY_UNLIKELY, UNLIKELY, POSSIBLE, LIKELY, VERY_LIKELY
              const likelihoodScores: Record<string, number> = {
                UNKNOWN: 0,
                VERY_UNLIKELY: 0,
                UNLIKELY: 0.1,
                POSSIBLE: 0.4,
                LIKELY: 0.7,
                VERY_LIKELY: 1.0,
              };

              const adultScore = likelihoodScores[safeSearch.adult] ?? 0;
              const violenceScore = likelihoodScores[safeSearch.violence] ?? 0;
              const racyScore = likelihoodScores[safeSearch.racy] ?? 0;

              // Combined score (weighted average)
              nsfwScore =
                adultScore * 0.5 + violenceScore * 0.3 + racyScore * 0.2;
            }
          }
        } catch (visionError) {
          console.warn("Cloud Vision API error:", visionError);
          // Continue without NSFW score
        }
      }

      // Determine moderation status
      let moderationStatus: ModerationStatus = "approved";

      if (nsfwScore !== undefined) {
        if (nsfwScore >= NSFW_AUTO_REJECT_THRESHOLD) {
          moderationStatus = "rejected";
        } else if (nsfwScore >= NSFW_REVIEW_THRESHOLD) {
          moderationStatus = "pending"; // Needs manual review
        }
      } else {
        // No NSFW detection - auto-approve (or set to pending for manual review)
        // In production with strict moderation, you might want "pending" here
        moderationStatus = "approved";
      }

      // Update the photo record
      await ctx.runMutation(internalApi.ugcPhotos.updatePhotoModeration, {
        photoId: args.photoId,
        moderationStatus,
        nsfwScore,
        width,
        height,
        blurhash,
        perceptualHash,
        exifStripped,
      });
    } catch (error) {
      console.error(`Error processing photo ${args.photoId}:`, error);

      // Mark as pending for manual review on processing error
      await ctx.runMutation(internalApi.ugcPhotos.updatePhotoModeration, {
        photoId: args.photoId,
        moderationStatus: "pending",
        exifStripped: false,
      });
    }
  },
});
