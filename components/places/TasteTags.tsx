"use client";

import { Badge } from "@/components/ui/badge";
import { ThumbsUp, ThumbsDown } from "lucide-react";

interface Tag {
  tag: string;
  score: number;
  votesUp: number;
  votesDown: number;
}

interface TasteTagsProps {
  tags: Tag[];
  dishes?: Array<{ dish: string; mentionsCount: number }>;
  onVote?: (tag: string, vote: "up" | "down") => Promise<void>;
  isAuthenticated?: boolean;
}

export function TasteTags({
  tags,
  dishes,
  onVote,
  isAuthenticated,
}: TasteTagsProps) {
  if (tags.length === 0 && (!dishes || dishes.length === 0)) {
    return null;
  }

  const formatTagLabel = (tag: string) => {
    // Convert snake_case or kebab-case to Title Case
    return tag
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <div className="space-y-4">
      {dishes && dishes.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            What to Order
          </h3>
          <div className="flex flex-wrap gap-2">
            {dishes.map((dish) => (
              <Badge
                key={dish.dish}
                variant="outline"
                className="bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
              >
                {formatTagLabel(dish.dish)}
                {dish.mentionsCount > 1 && (
                  <span className="ml-1 text-xs opacity-70">
                    ({dish.mentionsCount})
                  </span>
                )}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {tags.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Community Tags
          </h3>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <div
                key={tag.tag}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 dark:border-zinc-700 dark:bg-zinc-800"
              >
                <span className="text-sm text-zinc-700 dark:text-zinc-300">
                  {formatTagLabel(tag.tag)}
                </span>
                {isAuthenticated && onVote && (
                  <div className="ml-1 flex items-center gap-0.5">
                    <button
                      onClick={() => onVote(tag.tag, "up")}
                      className="rounded p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                      title="Agree"
                    >
                      <ThumbsUp className="h-3 w-3 text-zinc-500" />
                    </button>
                    <button
                      onClick={() => onVote(tag.tag, "down")}
                      className="rounded p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                      title="Disagree"
                    >
                      <ThumbsDown className="h-3 w-3 text-zinc-500" />
                    </button>
                  </div>
                )}
                <span className="text-xs text-zinc-400">
                  +{tag.votesUp}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
