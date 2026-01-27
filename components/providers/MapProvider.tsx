"use client";

import { Libraries, LoadScript } from "@react-google-maps/api";
import { ReactNode, useCallback, useState } from "react";

/**
 * Google Maps library configuration
 * - places: Required for Places API autocomplete integration
 * - marker: Required for Advanced Markers API
 */
const GOOGLE_MAPS_LIBRARIES: Libraries = ["places", "marker"];

interface MapProviderProps {
  children: ReactNode;
}

/**
 * MapProvider wraps the application with Google Maps JavaScript API loader.
 *
 * Features:
 * - Lazy loads the Google Maps script
 * - Provides loading and error states
 * - Configures required libraries (places, marker)
 *
 * Environment:
 * - Requires NEXT_PUBLIC_GOOGLE_MAPS_KEY environment variable
 */
export function MapProvider({ children }: MapProviderProps) {
  const [loadError, setLoadError] = useState<Error | null>(null);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;

  const handleError = useCallback((error: Error) => {
    console.error("Google Maps failed to load:", error);
    setLoadError(error);
  }, []);

  // If no API key configured, render children without map functionality
  if (!apiKey) {
    if (process.env.NODE_ENV === "development") {
      console.warn("NEXT_PUBLIC_GOOGLE_MAPS_KEY not configured - map features disabled");
    }
    return <>{children}</>;
  }

  // If load error, render children with degraded functionality
  if (loadError) {
    return <>{children}</>;
  }

  return (
    <LoadScript
      googleMapsApiKey={apiKey}
      libraries={GOOGLE_MAPS_LIBRARIES}
      onError={handleError}
      loadingElement={<MapLoadingFallback />}
    >
      {children}
    </LoadScript>
  );
}

/**
 * Loading fallback shown while Google Maps script loads
 */
function MapLoadingFallback() {
  return (
    <div className="flex items-center justify-center p-4">
      <div className="animate-pulse text-muted-foreground">Loading maps...</div>
    </div>
  );
}
