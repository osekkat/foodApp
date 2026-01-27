"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Loader2 } from "lucide-react";

export function NearMeCard() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleNearMe = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      return;
    }

    setLoading(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        router.push(`/map?lat=${latitude}&lng=${longitude}&zoom=15`);
      },
      (err) => {
        setLoading(false);
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setError("Location permission denied");
            break;
          case err.POSITION_UNAVAILABLE:
            setError("Location unavailable");
            break;
          case err.TIMEOUT:
            setError("Location request timed out");
            break;
          default:
            setError("Failed to get location");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  }, [router]);

  return (
    <section className="mb-16 text-center">
      <button
        onClick={handleNearMe}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-full border-2 border-orange-600 px-8 py-4 text-lg font-medium text-orange-600 transition-colors hover:bg-orange-600 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed dark:border-orange-500 dark:text-orange-400 dark:hover:bg-orange-500 dark:hover:text-white"
      >
        {loading ? (
          <Loader2 className="size-6 animate-spin" />
        ) : (
          <MapPin className="size-6" />
        )}
        {loading ? "Getting location..." : "Find Food Near Me"}
      </button>
      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
    </section>
  );
}
