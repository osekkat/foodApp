"use client";

import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface FeatureDisabledNoticeProps {
  label: string;
  message?: string;
  className?: string;
}

export function FeatureDisabledNotice({ label, message, className }: FeatureDisabledNoticeProps) {
  const text = message ?? `${label} are temporarily unavailable to keep things fast.`;

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900",
        className
      )}
    >
      <ImageOff className="mt-0.5 h-4 w-4 text-amber-700" />
      <span>{text}</span>
    </div>
  );
}
