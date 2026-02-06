"use client";

import { useJsApiLoader, Libraries } from "@react-google-maps/api";
import { createContext, ReactNode, useContext } from "react";

/**
 * Google Maps library configuration
 * - places: Required for Places API autocomplete integration
 * - marker: Required for Advanced Markers API
 *
 * IMPORTANT: This must be defined outside the component to avoid
 * re-creating the array on every render, which would cause the
 * loader to re-initialize.
 */
const GOOGLE_MAPS_LIBRARIES: Libraries = ["places", "marker"];

interface MapContextValue {
  isLoaded: boolean;
  loadError: Error | undefined;
}

const MapContext = createContext<MapContextValue>({
  isLoaded: false,
  loadError: undefined,
});

export function useMapContext() {
  return useContext(MapContext);
}

interface MapProviderProps {
  children: ReactNode;
}

/**
 * MapProvider wraps the application with Google Maps JavaScript API loader.
 *
 * Uses `useJsApiLoader` instead of `LoadScript` to avoid the
 * "google api is already presented" error that occurs on client-side
 * navigation or hot-reload (LoadScript tries to inject the script tag
 * on every mount; useJsApiLoader is idempotent).
 *
 * Features:
 * - Safely loads the Google Maps script (idempotent)
 * - Provides loading and error states via context
 * - Configures required libraries (places, marker)
 *
 * Environment:
 * - Requires NEXT_PUBLIC_GOOGLE_MAPS_KEY environment variable
 */
export function MapProvider({ children }: MapProviderProps) {
  const apiKey =
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ??
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ??
    "";

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    libraries: GOOGLE_MAPS_LIBRARIES,
    // Prevent loading if no API key is configured
    preventGoogleFontsLoading: false,
  });

  if (!apiKey) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "NEXT_PUBLIC_GOOGLE_MAPS_KEY (or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) not configured - map features disabled"
      );
    }
    return <>{children}</>;
  }

  if (loadError) {
    console.error("Google Maps failed to load:", loadError);
  }

  return (
    <MapContext.Provider value={{ isLoaded, loadError }}>
      {children}
    </MapContext.Provider>
  );
}
