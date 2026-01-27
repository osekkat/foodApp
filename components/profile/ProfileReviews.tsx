"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { Star, ThumbsUp, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";

export function ProfileReviews() {
  const reviews = useQuery(api.profile.getMyReviews, { limit: 20 });
  const deleteReview = useMutation(api.profile.deleteMyReview);
  const [deletingId, setDeletingId] = useState<Id<"reviews"> | null>(null);

  const handleDelete = async (reviewId: Id<"reviews">) => {
    if (!confirm("Are you sure you want to delete this review?")) return;
    setDeletingId(reviewId);
    try {
      await deleteReview({ reviewId });
    } finally {
      setDeletingId(null);
    }
  };

  if (reviews === undefined) {
    return <ReviewsSkeleton />;
  }

  if (reviews.reviews.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-zinc-500 dark:text-zinc-400">You haven&apos;t written any reviews yet.</p>
        <p className="mt-2 text-sm text-zinc-400 dark:text-zinc-500">
          Visit a place and share your experience!
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {reviews.reviews.map((review) => (
        <div
          key={review._id}
          className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                {formatPlaceKey(review.placeKey)}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className={`size-4 ${
                        star <= review.rating
                          ? "fill-yellow-400 text-yellow-400"
                          : "text-zinc-300 dark:text-zinc-600"
                      }`}
                    />
                  ))}
                </div>
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  {formatDistanceToNow(review.createdAt, { addSuffix: true })}
                </span>
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDelete(review._id)}
              disabled={deletingId === review._id}
              className="text-zinc-400 hover:text-red-500"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>

          {review.text && (
            <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">{review.text}</p>
          )}

          {review.dishesTried && review.dishesTried.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {review.dishesTried.map((dish, i) => (
                <span
                  key={i}
                  className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
                >
                  {dish}
                </span>
              ))}
            </div>
          )}

          {review.helpfulCount > 0 && (
            <div className="mt-3 flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
              <ThumbsUp className="size-3" />
              {review.helpfulCount} found this helpful
            </div>
          )}
        </div>
      ))}

      {reviews.hasMore && (
        <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
          Showing first 20 reviews
        </p>
      )}
    </div>
  );
}

function formatPlaceKey(placeKey: string): string {
  if (placeKey.startsWith("c:")) {
    return placeKey.slice(2).replace(/-/g, " ");
  }
  if (placeKey.startsWith("g:")) {
    return "Google Place";
  }
  return placeKey;
}

function ReviewsSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-2 h-4 w-24" />
          <Skeleton className="mt-3 h-16 w-full" />
        </div>
      ))}
    </div>
  );
}
