"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export type FeatureFlagKey =
  | "photos_enabled"
  | "open_now_enabled"
  | "provider_search_enabled"
  | "autocomplete_enabled"
  | "map_search_enabled";

const DEFAULT_FLAGS: Record<FeatureFlagKey, boolean> = {
  photos_enabled: true,
  open_now_enabled: true,
  provider_search_enabled: true,
  autocomplete_enabled: true,
  map_search_enabled: true,
};

export function useFeatureFlag(key: FeatureFlagKey): boolean {
  const flags = useQuery(api.featureFlags.getAll);

  if (!flags) {
    return DEFAULT_FLAGS[key];
  }

  return flags[key] ?? DEFAULT_FLAGS[key];
}

export function useFeatureFlags(): Record<FeatureFlagKey, boolean> {
  const flags = useQuery(api.featureFlags.getAll);
  if (!flags) {
    return DEFAULT_FLAGS;
  }
  return { ...DEFAULT_FLAGS, ...flags };
}
