"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { Heart, Lock, Globe, List } from "lucide-react";
import Link from "next/link";

export function ProfileLists() {
  const lists = useQuery(api.profile.getMyLists);

  if (lists === undefined) {
    return <ListsSkeleton />;
  }

  if (lists.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-zinc-500 dark:text-zinc-400">You don&apos;t have any lists yet.</p>
        <p className="mt-2 text-sm text-zinc-400 dark:text-zinc-500">
          Save places to lists to organize your favorites!
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {lists.map((list) => (
        <Link
          key={list._id}
          href={`/lists/${list._id}`}
          className="group rounded-lg border border-zinc-200 p-4 transition-colors hover:border-orange-300 dark:border-zinc-800 dark:hover:border-orange-700"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800">
              {list.type === "favorites" ? (
                <Heart className="size-5 text-red-500" />
              ) : (
                <List className="size-5 text-zinc-500 dark:text-zinc-400" />
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-zinc-900 group-hover:text-orange-600 dark:text-zinc-100 dark:group-hover:text-orange-400">
                  {list.name}
                </h3>
                {list.visibility === "private" ? (
                  <Lock className="size-3 text-zinc-400" />
                ) : (
                  <Globe className="size-3 text-zinc-400" />
                )}
              </div>
              {list.description && (
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400 line-clamp-2">
                  {list.description}
                </p>
              )}
              <div className="mt-2 flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {list.itemCount} {list.itemCount === 1 ? "place" : "places"}
                </Badge>
                {list.updatedAt && (
                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                    Updated {formatDistanceToNow(list.updatedAt, { addSuffix: true })}
                  </span>
                )}
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function ListsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="flex items-start gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex-1">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="mt-2 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-20" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
