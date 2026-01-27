"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";

function getInitials(name: string | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function ProfileHeader() {
  const profile = useQuery(api.profile.getMyProfile);

  if (profile === undefined) {
    return <ProfileHeaderSkeleton />;
  }

  if (!profile) {
    return null;
  }

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-6">
      <Avatar className="size-20 sm:size-24">
        {profile.image && <AvatarImage src={profile.image} alt={profile.name || "User"} />}
        <AvatarFallback className="text-2xl">{getInitials(profile.name)}</AvatarFallback>
      </Avatar>

      <div className="flex-1 text-center sm:text-left">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          {profile.name || "User"}
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{profile.email}</p>
        {profile.createdAt && (
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            Member for {formatDistanceToNow(profile.createdAt)}
          </p>
        )}

        <div className="mt-4 flex flex-wrap justify-center gap-6 sm:justify-start">
          <StatItem label="Reviews" value={profile.stats.reviewCount} />
          <StatItem label="Helpful votes" value={profile.stats.helpfulVotesReceived} />
          <StatItem label="Lists" value={profile.stats.listsCount} />
          <StatItem label="Favorites" value={profile.stats.favoritesCount} />
        </div>
      </div>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{value}</p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
    </div>
  );
}

function ProfileHeaderSkeleton() {
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-6">
      <Skeleton className="size-20 rounded-full sm:size-24" />
      <div className="flex-1 space-y-2 text-center sm:text-left">
        <Skeleton className="mx-auto h-8 w-40 sm:mx-0" />
        <Skeleton className="mx-auto h-4 w-48 sm:mx-0" />
        <Skeleton className="mx-auto h-3 w-32 sm:mx-0" />
        <div className="mt-4 flex flex-wrap justify-center gap-6 sm:justify-start">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="text-center">
              <Skeleton className="mx-auto h-6 w-8" />
              <Skeleton className="mt-1 h-3 w-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
