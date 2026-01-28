"use client";

import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";
import type { Id } from "@/convex/_generated/dataModel";

// Work around TypeScript depth limitations with complex Convex types
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const apiRef: any = require("@/convex/_generated/api").api;

/**
 * Optimistic update hooks for user actions
 *
 * These hooks wrap Convex mutations with optimistic updates for better UX.
 * Optimistic updates show the expected result immediately while the actual
 * mutation runs in the background. If the mutation fails, changes are rolled back.
 */

// ============================================================================
// Toggle Favorite
// ============================================================================

export interface UseToggleFavoriteOptions {
  placeKey: string;
}

export interface UseToggleFavoriteResult {
  isFavorited: boolean;
  isLoading: boolean;
  toggle: () => Promise<void>;
  error: Error | null;
}

/**
 * Hook for toggling favorite with optimistic update
 *
 * @example
 * ```tsx
 * const { isFavorited, toggle, isLoading } = useToggleFavorite({ placeKey: "g:abc123" });
 *
 * <button onClick={toggle} disabled={isLoading}>
 *   {isFavorited ? "Remove from Favorites" : "Add to Favorites"}
 * </button>
 * ```
 */
export function useToggleFavorite(options: UseToggleFavoriteOptions): UseToggleFavoriteResult {
  const { placeKey } = options;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Query current favorite status
  const isFavorited = useQuery(apiRef.lists.isInFavorites, { placeKey }) ?? false;

  // Mutation with optimistic update
  const toggleFavoriteMutation = useMutation(apiRef.lists.toggleFavorite).withOptimisticUpdate(
    (localStore: OptimisticLocalStore) => {
      // Optimistically toggle the favorite status
      const currentStatus = localStore.getQuery(apiRef.lists.isInFavorites, { placeKey });
      localStore.setQuery(apiRef.lists.isInFavorites, { placeKey }, !currentStatus);
    }
  );

  const toggle = useCallback(async () => {
    if (isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      await toggleFavoriteMutation({ placeKey });
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to toggle favorite"));
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, placeKey, toggleFavoriteMutation]);

  return { isFavorited, isLoading, toggle, error };
}

// ============================================================================
// Add to List
// ============================================================================

export interface UseAddToListOptions {
  listId: Id<"lists">;
}

export interface UseAddToListResult {
  addToList: (placeKey: string, options?: { timeSlot?: string; itemNote?: string }) => Promise<void>;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook for adding to list with optimistic update
 */
export function useAddToList(options: UseAddToListOptions): UseAddToListResult {
  const { listId } = options;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const addToListMutation = useMutation(apiRef.lists.addToList).withOptimisticUpdate(
    (
      localStore: OptimisticLocalStore,
      args: { listId: Id<"lists">; placeKey: string; timeSlot?: string; itemNote?: string }
    ) => {
      // Optimistically add to list items query
      const items = localStore.getQuery(apiRef.lists.getListItems, { listId: args.listId });
      if (items) {
        const optimisticItem = {
          _id: `optimistic_${Date.now()}` as Id<"listItems">,
          _creationTime: Date.now(),
          listId: args.listId,
          placeKey: args.placeKey,
          sortOrder: items.length,
          timeSlot: args.timeSlot,
          itemNote: args.itemNote,
          createdAt: Date.now(),
        };
        localStore.setQuery(apiRef.lists.getListItems, { listId: args.listId }, [...items, optimisticItem]);
      }

      // Update list item count
      const list = localStore.getQuery(apiRef.lists.getList, { listId: args.listId });
      if (list) {
        localStore.setQuery(apiRef.lists.getList, { listId: args.listId }, {
          ...list,
          itemCount: list.itemCount + 1,
        });
      }

      // Mark as in list
      localStore.setQuery(apiRef.lists.isInList, { listId: args.listId, placeKey: args.placeKey }, true);
    }
  );

  const addToList = useCallback(
    async (placeKey: string, opts?: { timeSlot?: string; itemNote?: string }) => {
      if (isLoading) return;

      setIsLoading(true);
      setError(null);

      try {
        await addToListMutation({
          listId,
          placeKey,
          timeSlot: opts?.timeSlot as "breakfast" | "lunch" | "dinner" | "snack" | undefined,
          itemNote: opts?.itemNote,
        });
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to add to list"));
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, listId, addToListMutation]
  );

  return { addToList, isLoading, error };
}

// ============================================================================
// Remove from List
// ============================================================================

export interface UseRemoveFromListOptions {
  listId: Id<"lists">;
}

export interface UseRemoveFromListResult {
  removeFromList: (placeKey: string) => Promise<void>;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook for removing from list with optimistic update
 */
export function useRemoveFromList(options: UseRemoveFromListOptions): UseRemoveFromListResult {
  const { listId } = options;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const removeFromListMutation = useMutation(apiRef.lists.removeFromList).withOptimisticUpdate(
    (localStore: OptimisticLocalStore, args: { listId: Id<"lists">; placeKey: string }) => {
      // Optimistically remove from list items
      const items = localStore.getQuery(apiRef.lists.getListItems, { listId: args.listId });
      if (items) {
        const filtered = items.filter((item: { placeKey: string }) => item.placeKey !== args.placeKey);
        localStore.setQuery(apiRef.lists.getListItems, { listId: args.listId }, filtered);
      }

      // Update list item count
      const list = localStore.getQuery(apiRef.lists.getList, { listId: args.listId });
      if (list) {
        localStore.setQuery(apiRef.lists.getList, { listId: args.listId }, {
          ...list,
          itemCount: Math.max(0, list.itemCount - 1),
        });
      }

      // Mark as not in list
      localStore.setQuery(apiRef.lists.isInList, { listId: args.listId, placeKey: args.placeKey }, false);
    }
  );

  const removeFromList = useCallback(
    async (placeKey: string) => {
      if (isLoading) return;

      setIsLoading(true);
      setError(null);

      try {
        await removeFromListMutation({ listId, placeKey });
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to remove from list"));
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, listId, removeFromListMutation]
  );

  return { removeFromList, isLoading, error };
}

// ============================================================================
// Mark Review Helpful
// ============================================================================

export interface UseMarkHelpfulOptions {
  reviewId: Id<"reviews">;
}

export interface UseMarkHelpfulResult {
  hasMarked: boolean;
  /** Delta to add to the review's helpfulCount for optimistic display (typically +1 or -1) */
  helpfulCountDelta: number;
  markHelpful: () => Promise<void>;
  unmarkHelpful: () => Promise<void>;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook for marking review as helpful with optimistic update
 *
 * @example
 * ```tsx
 * const { hasMarked, helpfulCountDelta, markHelpful, unmarkHelpful, isLoading } = useMarkHelpful({
 *   reviewId: review._id,
 * });
 *
 * // Add helpfulCountDelta to the actual review.helpfulCount for display
 * <button onClick={hasMarked ? unmarkHelpful : markHelpful} disabled={isLoading}>
 *   Helpful ({review.helpfulCount + helpfulCountDelta})
 * </button>
 * ```
 */
export function useMarkHelpful(options: UseMarkHelpfulOptions): UseMarkHelpfulResult {
  const { reviewId } = options;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Query current helpful status
  const hasMarked = useQuery(apiRef.reviews.hasMarkedHelpful, { reviewId }) ?? false;

  // We don't have a direct query for review helpfulCount, but the component
  // should pass it from the review data. We'll track it locally for optimistic updates.
  const [optimisticCountDelta, setOptimisticCountDelta] = useState(0);

  // Mark helpful mutation with optimistic update
  const markHelpfulMutation = useMutation(apiRef.reviews.markReviewHelpful).withOptimisticUpdate(
    (localStore: OptimisticLocalStore) => {
      localStore.setQuery(apiRef.reviews.hasMarkedHelpful, { reviewId }, true);
    }
  );

  // Unmark helpful mutation with optimistic update
  const unmarkHelpfulMutation = useMutation(apiRef.reviews.unmarkReviewHelpful).withOptimisticUpdate(
    (localStore: OptimisticLocalStore) => {
      localStore.setQuery(apiRef.reviews.hasMarkedHelpful, { reviewId }, false);
    }
  );

  const markHelpful = useCallback(async () => {
    if (isLoading || hasMarked) return;

    setIsLoading(true);
    setError(null);
    setOptimisticCountDelta((d) => d + 1);

    try {
      await markHelpfulMutation({ reviewId });
      // Reset delta on success - server now has the updated count
      setOptimisticCountDelta(0);
    } catch (err) {
      setOptimisticCountDelta((d) => d - 1); // Rollback
      setError(err instanceof Error ? err : new Error("Failed to mark as helpful"));
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, hasMarked, reviewId, markHelpfulMutation]);

  const unmarkHelpful = useCallback(async () => {
    if (isLoading || !hasMarked) return;

    setIsLoading(true);
    setError(null);
    setOptimisticCountDelta((d) => d - 1);

    try {
      await unmarkHelpfulMutation({ reviewId });
      // Reset delta on success - server now has the updated count
      setOptimisticCountDelta(0);
    } catch (err) {
      setOptimisticCountDelta((d) => d + 1); // Rollback
      setError(err instanceof Error ? err : new Error("Failed to unmark helpful"));
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, hasMarked, reviewId, unmarkHelpfulMutation]);

  return {
    hasMarked,
    helpfulCountDelta: optimisticCountDelta,
    markHelpful,
    unmarkHelpful,
    isLoading,
    error,
  };
}

// ============================================================================
// Submit Review (Upsert)
// ============================================================================

export interface ReviewSubmissionData {
  placeKey: string;
  rating: number;
  text?: string;
  dishesTried?: string[];
  pricePaidBucketMad?: "<30" | "30-70" | "70-150" | "150+";
  visitContext?: "solo" | "couple" | "family" | "friends" | "business";
  photoIds?: Id<"ugcPhotos">[];
}

export interface UseSubmitReviewResult {
  submitReview: (data: ReviewSubmissionData) => Promise<{ reviewId: Id<"reviews">; isNewReview: boolean } | null>;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook for submitting review with optimistic update
 *
 * Shows the review immediately with a "Posting..." indicator while
 * the actual mutation runs in the background.
 */
export function useSubmitReview(): UseSubmitReviewResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Upsert review mutation with optimistic update
  const upsertReviewMutation = useMutation(apiRef.reviews.upsertReview).withOptimisticUpdate(
    (localStore: OptimisticLocalStore, args: ReviewSubmissionData) => {
      // Optimistically update the user's review for this place
      const optimisticReview = {
        _id: `optimistic_${Date.now()}` as Id<"reviews">,
        _creationTime: Date.now(),
        userId: "optimistic_user" as Id<"users">,
        placeKey: args.placeKey,
        rating: args.rating,
        text: args.text,
        dishesTried: args.dishesTried,
        pricePaidBucketMad: args.pricePaidBucketMad,
        visitContext: args.visitContext,
        photoIds: args.photoIds,
        helpfulCount: 0,
        createdAt: Date.now(),
        // Mark as optimistic for UI to show "Posting..."
        _optimistic: true,
      };

      localStore.setQuery(apiRef.reviews.getUserReviewForPlace, { placeKey: args.placeKey }, optimisticReview);
    }
  );

  const submitReview = useCallback(
    async (data: ReviewSubmissionData) => {
      if (isLoading) return null;

      setIsLoading(true);
      setError(null);

      try {
        const result = await upsertReviewMutation(data);
        return result;
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to submit review"));
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, upsertReviewMutation]
  );

  return { submitReview, isLoading, error };
}

// ============================================================================
// Delete Review
// ============================================================================

export interface UseDeleteReviewResult {
  deleteReview: (reviewId: Id<"reviews">, placeKey: string) => Promise<void>;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook for deleting review with optimistic update
 */
export function useDeleteReview(): UseDeleteReviewResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Store placeKey in ref for access in optimistic update callback
  const placeKeyRef = useRef<string | null>(null);

  const deleteReviewMutation = useMutation(apiRef.reviews.deleteReview).withOptimisticUpdate(
    (localStore: OptimisticLocalStore) => {
      // Optimistically clear the user's review for this place
      if (placeKeyRef.current) {
        localStore.setQuery(apiRef.reviews.getUserReviewForPlace, { placeKey: placeKeyRef.current }, null);
      }
    }
  );

  const deleteReview = useCallback(
    async (reviewId: Id<"reviews">, placeKey: string) => {
      if (isLoading) return;

      setIsLoading(true);
      setError(null);
      placeKeyRef.current = placeKey; // Store for optimistic update

      try {
        await deleteReviewMutation({ reviewId });
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to delete review"));
      } finally {
        setIsLoading(false);
        placeKeyRef.current = null; // Clear after operation
      }
    },
    [isLoading, deleteReviewMutation]
  );

  return { deleteReview, isLoading, error };
}

// ============================================================================
// Tag Vote (Upvote/Downvote)
// ============================================================================

export interface UseTagVoteOptions {
  placeKey: string;
  tag: string;
}

export interface UseTagVoteResult {
  upvote: () => Promise<void>;
  downvote: () => Promise<void>;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook for tag voting with optimistic update
 *
 * Tags can be upvoted or downvoted to reflect agreement/disagreement
 * with a tag on a place.
 *
 * Note: The API uses "up"/"down" string literals, not numeric votes.
 * Each vote increments votesUp or votesDown on the tag.
 */
export function useTagVote(options: UseTagVoteOptions): UseTagVoteResult {
  const { placeKey, tag } = options;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Vote mutation with optimistic update
  const voteTagMutation = useMutation(apiRef.tags.voteTag).withOptimisticUpdate(
    (localStore: OptimisticLocalStore, args: { placeKey: string; tag: string; vote: "up" | "down" }) => {
      // Optimistically update the tag's vote counts
      const tags = localStore.getQuery(apiRef.tags.getPlaceTags, { placeKey: args.placeKey });
      if (tags) {
        const updatedTags = tags.map(
          (t: { tag: string; votesUp: number; votesDown: number; netVotes: number; totalVotes: number }) => {
            if (t.tag === args.tag) {
              const newVotesUp = args.vote === "up" ? t.votesUp + 1 : t.votesUp;
              const newVotesDown = args.vote === "down" ? t.votesDown + 1 : t.votesDown;
              return {
                ...t,
                votesUp: newVotesUp,
                votesDown: newVotesDown,
                netVotes: newVotesUp - newVotesDown,
                totalVotes: newVotesUp + newVotesDown,
              };
            }
            return t;
          }
        );
        localStore.setQuery(apiRef.tags.getPlaceTags, { placeKey: args.placeKey }, updatedTags);
      }
    }
  );

  const vote = useCallback(
    async (voteType: "up" | "down") => {
      if (isLoading) return;

      setIsLoading(true);
      setError(null);

      try {
        await voteTagMutation({ placeKey, tag, vote: voteType });
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to vote on tag"));
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, placeKey, tag, voteTagMutation]
  );

  const upvote = useCallback(() => vote("up"), [vote]);
  const downvote = useCallback(() => vote("down"), [vote]);

  return {
    upvote,
    downvote,
    isLoading,
    error,
  };
}
