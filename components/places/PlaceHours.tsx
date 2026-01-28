"use client";

import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import { useState } from "react";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { useServiceMode } from "@/components/providers/ServiceModeProvider";

interface PlaceHoursProps {
  openNow?: boolean;
  weekdayDescriptions?: string[];
}

export function PlaceHours({ openNow, weekdayDescriptions }: PlaceHoursProps) {
  const [expanded, setExpanded] = useState(false);
  const openNowEnabled = useFeatureFlag("open_now_enabled");
  const serviceMode = useServiceMode();

  if (!weekdayDescriptions || weekdayDescriptions.length === 0) {
    return null;
  }

  // Get today's day of week (0 = Sunday, 1 = Monday, etc.)
  const today = new Date().getDay();
  // Convert to API format (Monday = 0)
  const todayIndex = today === 0 ? 6 : today - 1;
  const todayHours = weekdayDescriptions[todayIndex];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-zinc-500" />
        {openNow !== undefined && openNowEnabled && (
          <Badge
            variant={openNow ? "default" : "secondary"}
            className={openNow ? "bg-green-600" : ""}
          >
            {openNow ? "Open now" : "Closed"}
          </Badge>
        )}
        {openNow !== undefined && !openNowEnabled && serviceMode.currentMode === 1 && (
          <span className="text-xs text-zinc-500">Reduced features to keep things fast</span>
        )}
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          {todayHours}
          <span className="ml-1 text-zinc-400">
            {expanded ? "▲" : "▼"}
          </span>
        </button>
      </div>

      {expanded && (
        <ul className="ml-6 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
          {weekdayDescriptions.map((desc, i) => (
            <li
              key={i}
              className={i === todayIndex ? "font-medium text-zinc-900 dark:text-zinc-100" : ""}
            >
              {desc}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
