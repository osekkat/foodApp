"use client";

import Link from "next/link";
import { Book, MapPin, UtensilsCrossed, MessageSquare, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface OwnedResult {
  type: "curated" | "guide" | "review" | "dish";
  id: string;
  title: string;
  subtitle?: string;
  placeKey?: string;
  score: number;
}

export interface OwnedResultCardProps {
  result: OwnedResult;
}

function getTypeIcon(type: OwnedResult["type"]) {
  switch (type) {
    case "curated":
      return <MapPin className="h-5 w-5" />;
    case "guide":
      return <Book className="h-5 w-5" />;
    case "dish":
      return <UtensilsCrossed className="h-5 w-5" />;
    case "review":
      return <MessageSquare className="h-5 w-5" />;
  }
}

function getTypeLabel(type: OwnedResult["type"]) {
  switch (type) {
    case "curated":
      return "Place";
    case "guide":
      return "Guide";
    case "dish":
      return "Dish";
    case "review":
      return "Review";
  }
}

function getTypeColor(type: OwnedResult["type"]) {
  switch (type) {
    case "curated":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
    case "guide":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
    case "dish":
      return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400";
    case "review":
      return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400";
  }
}

function getLinkForResult(result: OwnedResult): string {
  switch (result.type) {
    case "curated":
      // placeKey format: "c:slug"
      if (result.placeKey?.startsWith("c:")) {
        const slug = result.placeKey.slice(2);
        return `/place/c/${slug}`;
      }
      return `/place/c/${result.id}`;
    case "guide":
      return `/guides/${result.id}`;
    case "dish":
      return `/explore/dishes/${encodeURIComponent(result.title.toLowerCase())}`;
    case "review":
      // placeKey format: "g:placeId"
      if (result.placeKey?.startsWith("g:")) {
        const placeId = result.placeKey.slice(2);
        return `/place/g/${placeId}`;
      }
      return `/place/g/${result.placeKey}`;
  }
}

export function OwnedResultCard({ result }: OwnedResultCardProps) {
  const href = getLinkForResult(result);

  return (
    <Link
      href={href}
      className="flex items-start gap-3 p-3 rounded-lg border border-zinc-200 bg-white hover:border-orange-300 hover:shadow-sm transition-all dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-orange-600"
    >
      <div
        className={`flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-lg ${getTypeColor(result.type)}`}
      >
        {getTypeIcon(result.type)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="secondary" className="text-xs">
            {getTypeLabel(result.type)}
          </Badge>
        </div>
        <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
          {result.title}
        </p>
        {result.subtitle && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400 line-clamp-1">
            {result.subtitle}
          </p>
        )}
      </div>
      <ChevronRight className="h-5 w-5 text-zinc-400 flex-shrink-0 mt-2.5" />
    </Link>
  );
}
