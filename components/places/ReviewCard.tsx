"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Star, ThumbsUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ReviewCardProps {
  review: {
    _id: string;
    rating: number;
    text?: string;
    dishesTried?: string[];
    pricePaidBucketMad?: string;
    visitContext?: string;
    helpfulCount: number;
    createdAt: number;
    user?: {
      name?: string;
      image?: string;
    } | null;
  };
  onMarkHelpful?: (reviewId: string) => Promise<void>;
  isAuthenticated?: boolean;
}

export function ReviewCard({
  review,
  onMarkHelpful,
  isAuthenticated,
}: ReviewCardProps) {
  const userName = review.user?.name || "Anonymous";
  const userInitial = userName.charAt(0).toUpperCase();

  const formatPriceBucket = (bucket?: string) => {
    if (!bucket) return null;
    const mapping: Record<string, string> = {
      "under_30": "<30 MAD",
      "30_70": "30-70 MAD",
      "70_150": "70-150 MAD",
      "over_150": "150+ MAD",
    };
    return mapping[bucket] || bucket;
  };

  return (
    <div className="border-b border-zinc-100 py-4 last:border-0 dark:border-zinc-800">
      <div className="flex items-start gap-3">
        <Avatar className="h-10 w-10">
          <AvatarImage src={review.user?.image} alt={userName} />
          <AvatarFallback className="bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
            {userInitial}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {userName}
            </span>
            <span className="text-xs text-zinc-400">
              {formatDistanceToNow(new Date(review.createdAt), {
                addSuffix: true,
              })}
            </span>
          </div>

          <div className="mt-1 flex items-center gap-2">
            <div className="flex items-center">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={`h-4 w-4 ${
                    star <= review.rating
                      ? "fill-amber-500 text-amber-500"
                      : "text-zinc-300 dark:text-zinc-600"
                  }`}
                />
              ))}
            </div>
            {review.pricePaidBucketMad && (
              <Badge variant="outline" className="text-xs">
                {formatPriceBucket(review.pricePaidBucketMad)}
              </Badge>
            )}
            {review.visitContext && (
              <Badge variant="outline" className="text-xs capitalize">
                {review.visitContext.replace(/_/g, " ")}
              </Badge>
            )}
          </div>

          {review.text && (
            <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
              {review.text}
            </p>
          )}

          {review.dishesTried && review.dishesTried.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {review.dishesTried.map((dish) => (
                <Badge
                  key={dish}
                  variant="secondary"
                  className="text-xs capitalize"
                >
                  {dish}
                </Badge>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onMarkHelpful?.(review._id)}
              disabled={!isAuthenticated}
              className="h-7 gap-1 px-2 text-xs text-zinc-500"
            >
              <ThumbsUp className="h-3 w-3" />
              Helpful
              {review.helpfulCount > 0 && (
                <span className="ml-1">({review.helpfulCount})</span>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
