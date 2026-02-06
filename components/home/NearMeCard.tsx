"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Loader2 } from "lucide-react";

export function NearMeCard() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Fallback: default to Casablanca when geolocation is unavailable
  const fallbackToCasablanca = useCallback(() => {
    router.push("/map?lat=33.5731&lng=-7.5898&zoom=13");
  }, [router]);

  const handleNearMe = useCallback(() => {
    if (!navigator.geolocation) {
      fallbackToCasablanca();
      return;
    }

    setLoading(true);
    let resolved = false;

    const resolve = (url: string) => {
      if (resolved) return;
      resolved = true;
      router.push(url);
    };

    const fallback = () => {
      if (resolved) return;
      resolved = true;
      setLoading(false);
      fallbackToCasablanca();
    };

    // Hard timeout: if geolocation doesn't respond at all (e.g. embedded
    // browsers that never prompt), fall back after 4 seconds.
    const hardTimeout = setTimeout(fallback, 4000);

    const onSuccess = (position: GeolocationPosition) => {
      clearTimeout(hardTimeout);
      const { latitude, longitude } = position.coords;
      resolve(`/map?lat=${latitude}&lng=${longitude}&zoom=15`);
    };

    const onFail = () => {
      clearTimeout(hardTimeout);
      fallback();
    };

    // Try low-accuracy first (fast, works on desktops)
    navigator.geolocation.getCurrentPosition(onSuccess, () => {
      // If low-accuracy fails, retry with high accuracy (GPS)
      navigator.geolocation.getCurrentPosition(onSuccess, onFail, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 120000,
      });
    }, {
      enableHighAccuracy: false,
      timeout: 3000,
      maximumAge: 300000,
    });
  }, [router, fallbackToCasablanca]);

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
      
    </section>
  );
}
