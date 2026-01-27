/**
 * UGC Photos - User-Generated Content Photo Management
 *
 * Implements photo upload with moderation pipeline:
 * - Client-side validation (size, type)
 * - Upload to Convex storage
 * - EXIF stripping for privacy
 * - Blurhash generation for placeholders
 * - Perceptual hash for duplicate detection
 * - NSFW detection via Cloud Vision SafeSearch
 *
 * Flow:
 * 1. Client uploads to storage (gets storageId)
 * 2. Client calls createPhoto mutation
 * 3. Mutation creates record (status: pending) and schedules moderation
 * 4. Internal action processes photo
 * 5. Action updates record with results and status
 *
 * POLICY: Only store owned content (user uploads). Never store provider photos.
 */

import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  QueryCtx,
  MutationCtx,
} from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id, Doc } from "./_generated/dataModel";

// ============================================================================
// Types & Constants
// ============================================================================

export type ModerationStatus = "pending" | "approved" | "rejected";

/** Maximum photos allowed per review */
export const MAX_PHOTOS_PER_REVIEW = 5;

/** Maximum file size (10MB) */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Allowed MIME types */
export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/** NSFW score threshold for auto-rejection */
export const NSFW_AUTO_REJECT_THRESHOLD = 0.7;

/** NSFW score threshold for manual review */
export const NSFW_REVIEW_THRESHOLD = 0.3;

// ============================================================================
// Auth Helpers
// ============================================================================

/**
 * Get authenticated user from session
 */
async function getAuthUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.email) return null;

  const user = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", identity.email))
    .first();

  return user;
}

/**
 * Require authenticated user (throws if not authenticated)
 */
async function requireAuthUser(ctx: QueryCtx | MutationCtx) {
  const user = await getAuthUser(ctx);
  if (!user) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "Authentication required",
    });
  }
  return user;
}

/**
 * Check if user has moderator role
 */
async function isModerator(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  const role = await ctx.db
    .query("userRoles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();

  return role?.role === "admin" || role?.role === "moderator";
}

// ============================================================================
// Upload & Creation
// ============================================================================

/**
 * Generate upload URL for client-side photo upload
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAuthUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Create a photo record after upload
 *
 * Client uploads file to storage first, then calls this with the storageId.
 * This creates the record and schedules moderation processing.
 */
export const createPhoto = mutation({
  args: {
    storageId: v.id("_storage"),
    placeKey: v.string(),
    reviewId: v.optional(v.id("reviews")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const now = Date.now();

    // Validate placeKey format
    if (!args.placeKey.startsWith("g:") && !args.placeKey.startsWith("c:")) {
      throw new ConvexError({
        code: "INVALID_PLACE_KEY",
        message: "placeKey must start with 'g:' or 'c:'",
      });
    }

    // If linked to a review, validate ownership and photo count
    if (args.reviewId) {
      const review = await ctx.db.get(args.reviewId);
      if (!review) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Review not found",
        });
      }

      if (review.userId !== user._id) {
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "You can only add photos to your own reviews",
        });
      }

      // Check photo count for this review
      const existingPhotos = await ctx.db
        .query("ugcPhotos")
        .withIndex("by_review", (q) => q.eq("reviewId", args.reviewId))
        .collect();

      if (existingPhotos.length >= MAX_PHOTOS_PER_REVIEW) {
        throw new ConvexError({
          code: "TOO_MANY_PHOTOS",
          message: `Maximum ${MAX_PHOTOS_PER_REVIEW} photos allowed per review`,
        });
      }
    }

    // Create photo record with pending status
    const photoId = await ctx.db.insert("ugcPhotos", {
      uploaderUserId: user._id,
      placeKey: args.placeKey,
      reviewId: args.reviewId,
      storageId: args.storageId,
      moderationStatus: "pending",
      exifStripped: false,
      createdAt: now,
    });

    // Schedule moderation processing
    // Work around TypeScript depth limitations with complex Convex types
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const internalApi: any = require("./_generated/api").internal;
    await ctx.scheduler.runAfter(0, internalApi.ugcPhotosNodeActions.processPhotoModeration, {
      photoId,
    });

    return { photoId };
  },
});

/**
 * Batch create multiple photos for a review
 */
export const createPhotosForReview = mutation({
  args: {
    storageIds: v.array(v.id("_storage")),
    placeKey: v.string(),
    reviewId: v.id("reviews"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const now = Date.now();

    // Validate placeKey format (same validation as createPhoto)
    if (!args.placeKey.startsWith("g:") && !args.placeKey.startsWith("c:")) {
      throw new ConvexError({
        code: "INVALID_PLACE_KEY",
        message: "placeKey must start with 'g:' or 'c:'",
      });
    }

    // Validate batch size
    if (args.storageIds.length > MAX_PHOTOS_PER_REVIEW) {
      throw new ConvexError({
        code: "TOO_MANY_PHOTOS",
        message: `Maximum ${MAX_PHOTOS_PER_REVIEW} photos allowed per review`,
      });
    }

    // Validate review ownership
    const review = await ctx.db.get(args.reviewId);
    if (!review) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Review not found",
      });
    }

    if (review.userId !== user._id) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You can only add photos to your own reviews",
      });
    }

    // Check existing photo count
    const existingPhotos = await ctx.db
      .query("ugcPhotos")
      .withIndex("by_review", (q) => q.eq("reviewId", args.reviewId))
      .collect();

    const totalPhotos = existingPhotos.length + args.storageIds.length;
    if (totalPhotos > MAX_PHOTOS_PER_REVIEW) {
      throw new ConvexError({
        code: "TOO_MANY_PHOTOS",
        message: `Maximum ${MAX_PHOTOS_PER_REVIEW} photos allowed per review. You have ${existingPhotos.length} existing photos.`,
      });
    }

    // Create all photo records
    const photoIds: Id<"ugcPhotos">[] = [];
    for (const storageId of args.storageIds) {
      const photoId = await ctx.db.insert("ugcPhotos", {
        uploaderUserId: user._id,
        placeKey: args.placeKey,
        reviewId: args.reviewId,
        storageId,
        moderationStatus: "pending",
        exifStripped: false,
        createdAt: now,
      });

      photoIds.push(photoId);
    }

    // Schedule moderation for each photo
    // Work around TypeScript depth limitations with complex Convex types
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const internalApi: any = require("./_generated/api").internal;
    for (const photoId of photoIds) {
      await ctx.scheduler.runAfter(0, internalApi.ugcPhotosNodeActions.processPhotoModeration, {
        photoId,
      });
    }

    return { photoIds };
  },
});

// ============================================================================
// Moderation Processing (Internal)
// ============================================================================

/**
 * Internal mutation to update photo after moderation processing
 */
export const updatePhotoModeration = internalMutation({
  args: {
    photoId: v.id("ugcPhotos"),
    moderationStatus: v.string(),
    nsfwScore: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    blurhash: v.optional(v.string()),
    perceptualHash: v.optional(v.string()),
    exifStripped: v.boolean(),
    // If a new processed image was uploaded, update storageId and delete old
    newStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const photo = await ctx.db.get(args.photoId);
    if (!photo) {
      // Photo was deleted during processing - clean up any new storage file
      if (args.newStorageId) {
        await ctx.storage.delete(args.newStorageId);
      }
      return;
    }

    // Store old storageId if we need to delete it after update
    const oldStorageId =
      args.newStorageId && args.newStorageId !== photo.storageId
        ? photo.storageId
        : null;

    // Update the DB record first (transactional)
    await ctx.db.patch(args.photoId, {
      moderationStatus: args.moderationStatus as ModerationStatus,
      nsfwScore: args.nsfwScore,
      width: args.width,
      height: args.height,
      blurhash: args.blurhash,
      perceptualHash: args.perceptualHash,
      exifStripped: args.exifStripped,
      // Update storageId if we uploaded a processed version
      ...(args.newStorageId && { storageId: args.newStorageId }),
    });

    // Delete old storage file after successful DB update (non-transactional)
    // If this fails, we have an orphaned file but no broken references
    if (oldStorageId) {
      await ctx.storage.delete(oldStorageId);
    }
  },
});

// NOTE: processPhotoModeration action has been moved to ugcPhotosNodeActions.ts
// because it requires Node.js runtime for sharp image processing

/**
 * Internal query to get photo record (for use in actions)
 */
export const getPhotoInternal = internalQuery({
  args: { photoId: v.id("ugcPhotos") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.photoId);
  },
});

// ============================================================================
// Public Queries
// ============================================================================

/**
 * Get photos for a place (only approved)
 */
export const getPhotosForPlace = query({
  args: {
    placeKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    const photos = await ctx.db
      .query("ugcPhotos")
      .withIndex("by_place", (q) => q.eq("placeKey", args.placeKey))
      .filter((q) => q.eq(q.field("moderationStatus"), "approved"))
      .order("desc")
      .take(limit);

    // Enrich with storage URLs
    return Promise.all(
      photos.map(async (photo) => {
        const url = await ctx.storage.getUrl(photo.storageId);
        return {
          ...photo,
          url,
        };
      })
    );
  },
});

/**
 * Get photos for a review (only approved)
 */
export const getPhotosForReview = query({
  args: {
    reviewId: v.id("reviews"),
  },
  handler: async (ctx, args) => {
    const photos = await ctx.db
      .query("ugcPhotos")
      .withIndex("by_review", (q) => q.eq("reviewId", args.reviewId))
      .filter((q) => q.eq(q.field("moderationStatus"), "approved"))
      .collect();

    // Enrich with storage URLs
    return Promise.all(
      photos.map(async (photo) => {
        const url = await ctx.storage.getUrl(photo.storageId);
        return {
          ...photo,
          url,
        };
      })
    );
  },
});

/**
 * Get a user's uploaded photos
 */
export const getUserPhotos = query({
  args: {
    limit: v.optional(v.number()),
    includeAllStatuses: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];

    const limit = args.limit ?? 50;

    let photosQuery = ctx.db
      .query("ugcPhotos")
      .filter((q) => q.eq(q.field("uploaderUserId"), user._id));

    // Only show approved by default (unless user wants all their photos)
    if (!args.includeAllStatuses) {
      photosQuery = photosQuery.filter((q) =>
        q.eq(q.field("moderationStatus"), "approved")
      );
    }

    const photos = await photosQuery.order("desc").take(limit);

    return Promise.all(
      photos.map(async (photo) => {
        const url = await ctx.storage.getUrl(photo.storageId);
        return {
          ...photo,
          url,
        };
      })
    );
  },
});

// ============================================================================
// Moderation Queue (Admin/Moderator Only)
// ============================================================================

/**
 * Get photos pending moderation
 */
export const getModerationQueue = query({
  args: {
    limit: v.optional(v.number()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "Authentication required",
      });
    }

    // Check moderator permissions
    const hasModerationAccess = await isModerator(ctx, user._id);
    if (!hasModerationAccess) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Moderator access required",
      });
    }

    const limit = args.limit ?? 50;
    const status = args.status ?? "pending";

    const photos = await ctx.db
      .query("ugcPhotos")
      .withIndex("by_status_recent", (q) =>
        q.eq("moderationStatus", status as ModerationStatus)
      )
      .order("asc") // Oldest first for FIFO processing
      .take(limit);

    // Enrich with uploader info and URLs
    return Promise.all(
      photos.map(async (photo) => {
        const uploader = await ctx.db.get(photo.uploaderUserId);
        const url = await ctx.storage.getUrl(photo.storageId);
        return {
          ...photo,
          url,
          uploader: uploader
            ? {
                name: uploader.name,
                email: uploader.email,
              }
            : null,
        };
      })
    );
  },
});

/**
 * Moderator action: approve a photo
 */
export const approvePhoto = mutation({
  args: {
    photoId: v.id("ugcPhotos"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    const hasModerationAccess = await isModerator(ctx, user._id);
    if (!hasModerationAccess) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Moderator access required",
      });
    }

    const photo = await ctx.db.get(args.photoId);
    if (!photo) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Photo not found",
      });
    }

    await ctx.db.patch(args.photoId, {
      moderationStatus: "approved",
    });

    // Log audit
    await ctx.db.insert("auditLogs", {
      actorUserId: user._id,
      action: "ugcPhoto.approve",
      targetType: "ugcPhoto",
      targetKey: args.photoId,
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Moderator action: reject a photo
 */
export const rejectPhoto = mutation({
  args: {
    photoId: v.id("ugcPhotos"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    const hasModerationAccess = await isModerator(ctx, user._id);
    if (!hasModerationAccess) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Moderator access required",
      });
    }

    const photo = await ctx.db.get(args.photoId);
    if (!photo) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Photo not found",
      });
    }

    await ctx.db.patch(args.photoId, {
      moderationStatus: "rejected",
    });

    // Log audit with reason
    await ctx.db.insert("auditLogs", {
      actorUserId: user._id,
      action: "ugcPhoto.reject",
      targetType: "ugcPhoto",
      targetKey: args.photoId,
      metadata: args.reason ? JSON.stringify({ reason: args.reason }) : undefined,
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Get moderation statistics
 */
export const getModerationStats = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) {
      throw new ConvexError({
        code: "UNAUTHENTICATED",
        message: "Authentication required",
      });
    }

    const hasModerationAccess = await isModerator(ctx, user._id);
    if (!hasModerationAccess) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Moderator access required",
      });
    }

    // Count by status
    const pending = await ctx.db
      .query("ugcPhotos")
      .withIndex("by_status_recent", (q) => q.eq("moderationStatus", "pending"))
      .collect();

    const approved = await ctx.db
      .query("ugcPhotos")
      .withIndex("by_status_recent", (q) =>
        q.eq("moderationStatus", "approved")
      )
      .collect();

    const rejected = await ctx.db
      .query("ugcPhotos")
      .withIndex("by_status_recent", (q) =>
        q.eq("moderationStatus", "rejected")
      )
      .collect();

    return {
      pendingCount: pending.length,
      approvedCount: approved.length,
      rejectedCount: rejected.length,
      totalCount: pending.length + approved.length + rejected.length,
    };
  },
});

// ============================================================================
// User Actions
// ============================================================================

/**
 * Delete a user's own photo
 */
export const deletePhoto = mutation({
  args: {
    photoId: v.id("ugcPhotos"),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    const photo = await ctx.db.get(args.photoId);
    if (!photo) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Photo not found",
      });
    }

    // User can only delete their own photos
    if (photo.uploaderUserId !== user._id) {
      // Unless they're a moderator
      const hasModerationAccess = await isModerator(ctx, user._id);
      if (!hasModerationAccess) {
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "You can only delete your own photos",
        });
      }
    }

    // Store storageId before deleting record (needed for storage cleanup)
    const storageIdToDelete = photo.storageId;

    // If attached to a review, update the review's photoIds first
    if (photo.reviewId) {
      const review = await ctx.db.get(photo.reviewId);
      if (review?.photoIds) {
        const updatedPhotoIds = review.photoIds.filter(
          (id) => id !== args.photoId
        );
        await ctx.db.patch(photo.reviewId, {
          photoIds: updatedPhotoIds.length > 0 ? updatedPhotoIds : undefined,
        });
      }
    }

    // Delete the DB record (transactional)
    await ctx.db.delete(args.photoId);

    // Delete the storage file last (non-transactional)
    // If this fails, we have an orphaned storage file (minor leak) but no broken references
    await ctx.storage.delete(storageIdToDelete);

    return { success: true };
  },
});
