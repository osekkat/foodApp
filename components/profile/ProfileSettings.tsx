"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export function ProfileSettings() {
  const profile = useQuery(api.profile.getMyProfile);
  const updateProfile = useMutation(api.profile.updateProfile);
  const updatePreferences = useMutation(api.profile.updatePreferences);

  const [name, setName] = useState("");
  const [locale, setLocale] = useState<"ar" | "fr" | "en">("en");
  const [distanceUnit, setDistanceUnit] = useState<"km" | "mi">("km");
  const [mapStyle, setMapStyle] = useState("standard");
  const [analyticsOptOut, setAnalyticsOptOut] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setName(profile.name || "");
      setLocale((profile.locale as "ar" | "fr" | "en") || "en");
      setDistanceUnit((profile.preferences.distanceUnit as "km" | "mi") || "km");
      setMapStyle(profile.preferences.mapStyle || "standard");
      setAnalyticsOptOut(profile.preferences.analyticsOptOut || false);
    }
  }, [profile]);

  if (profile === undefined) {
    return <SettingsSkeleton />;
  }

  if (!profile) {
    return null;
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all([
        updateProfile({ name, locale }),
        updatePreferences({ distanceUnit, mapStyle, analyticsOptOut }),
      ]);
      toast.success("Settings saved");
    } catch (error) {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl space-y-8">
      <section>
        <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Profile</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Your public profile information.
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1"
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Language
            </label>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as "ar" | "fr" | "en")}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="en">English</option>
              <option value="fr">Français</option>
              <option value="ar">العربية</option>
            </select>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Preferences</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Customize your app experience.
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Distance Unit
            </label>
            <select
              value={distanceUnit}
              onChange={(e) => setDistanceUnit(e.target.value as "km" | "mi")}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="km">Kilometers</option>
              <option value="mi">Miles</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Map Style
            </label>
            <select
              value={mapStyle}
              onChange={(e) => setMapStyle(e.target.value)}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="standard">Standard</option>
              <option value="satellite">Satellite</option>
              <option value="terrain">Terrain</option>
            </select>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Privacy</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Control your privacy settings.
        </p>
        <div className="mt-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={analyticsOptOut}
              onChange={(e) => setAnalyticsOptOut(e.target.checked)}
              className="size-4 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
            />
            <span className="text-sm text-zinc-700 dark:text-zinc-300">
              Opt out of analytics tracking
            </span>
          </label>
        </div>
      </section>

      <div className="pt-4">
        <Button onClick={handleSave} disabled={saving} className="bg-orange-600 hover:bg-orange-700">
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="max-w-xl space-y-8">
      {[1, 2, 3].map((section) => (
        <div key={section}>
          <Skeleton className="h-6 w-24" />
          <Skeleton className="mt-1 h-4 w-48" />
          <div className="mt-4 space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
