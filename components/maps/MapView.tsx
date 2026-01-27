"use client";

import { GoogleMap, MarkerClusterer } from "@react-google-maps/api";
import type { Clusterer } from "@react-google-maps/marker-clusterer";
import { useCallback, useMemo, useRef, useState } from "react";
import { PlaceMarker, type PlaceMarkerData } from "./PlaceMarker";
import { MOROCCO_MAP_STYLES } from "./mapStyles";

/**
 * Default center on Casablanca, Morocco
 */
const DEFAULT_CENTER = {
  lat: 33.5731,
  lng: -7.5898,
};

/**
 * Default zoom level for city view
 */
const DEFAULT_ZOOM = 13;

/**
 * Map container styling
 */
const containerStyle = {
  width: "100%",
  height: "100%",
};

/**
 * Cluster options for marker clustering
 * - Enable clustering when >50 markers visible
 * - Custom cluster styling
 */
const CLUSTER_OPTIONS = {
  minimumClusterSize: 3,
  maxZoom: 15,
  gridSize: 60,
  styles: [
    {
      textColor: "#ffffff",
      url: "", // Will use default, can customize
      height: 40,
      width: 40,
      textSize: 12,
    },
    {
      textColor: "#ffffff",
      url: "",
      height: 50,
      width: 50,
      textSize: 14,
    },
    {
      textColor: "#ffffff",
      url: "",
      height: 60,
      width: 60,
      textSize: 16,
    },
  ],
};

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface MapViewProps {
  /** Array of places to display as markers */
  places: PlaceMarkerData[];
  /** Callback when map bounds change (for "search this area" feature) */
  onBoundsChange?: (bounds: MapBounds) => void;
  /** Callback when a place marker is clicked */
  onPlaceClick?: (placeKey: string) => void;
  /** Initial center point */
  center?: { lat: number; lng: number };
  /** Initial zoom level */
  zoom?: number;
  /** Whether to show clustering (default: true) */
  enableClustering?: boolean;
  /** Custom CSS class for container */
  className?: string;
}

/**
 * MapView displays Google Map with place markers and optional clustering.
 *
 * Features:
 * - Marker clustering for performance with many places
 * - Custom Moroccan-themed map styling
 * - Bounds change callback for "search this area"
 * - Marker click handling for place selection
 * - Throttled updates during pan/zoom
 *
 * Performance:
 * - Marker recycling via React keys
 * - Throttled bounds updates (max 1 per 100ms)
 * - Clustering reduces render load
 */
export function MapView({
  places,
  onBoundsChange,
  onPlaceClick,
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  enableClustering = true,
  className,
}: MapViewProps) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const throttleRef = useRef<NodeJS.Timeout | null>(null);

  // Memoize map options to prevent unnecessary re-renders
  const mapOptions = useMemo<google.maps.MapOptions>(
    () => ({
      styles: MOROCCO_MAP_STYLES,
      disableDefaultUI: false,
      zoomControl: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      gestureHandling: "greedy",
      clickableIcons: false,
      minZoom: 5,
      maxZoom: 20,
    }),
    []
  );

  const handleMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    setIsMapLoaded(true);
  }, []);

  const handleBoundsChanged = useCallback(() => {
    if (!mapRef.current || !onBoundsChange) return;

    // Throttle bounds updates to max 1 per 100ms
    if (throttleRef.current) return;

    throttleRef.current = setTimeout(() => {
      throttleRef.current = null;

      const bounds = mapRef.current?.getBounds();
      if (!bounds) return;

      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();

      onBoundsChange({
        north: ne.lat(),
        south: sw.lat(),
        east: ne.lng(),
        west: sw.lng(),
      });
    }, 100);
  }, [onBoundsChange]);

  const handleMarkerClick = useCallback(
    (placeKey: string) => {
      onPlaceClick?.(placeKey);
    },
    [onPlaceClick]
  );

  // Render markers with or without clustering
  const renderMarkers = useCallback(
    (clusterer?: Clusterer) => {
      return places.map((place) => (
        <PlaceMarker
          key={place.placeKey}
          place={place}
          onClick={handleMarkerClick}
          clusterer={clusterer}
        />
      ));
    },
    [places, handleMarkerClick]
  );

  return (
    <div className={className} style={{ width: "100%", height: "100%" }}>
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={zoom}
        options={mapOptions}
        onLoad={handleMapLoad}
        onBoundsChanged={handleBoundsChanged}
      >
        {isMapLoaded && enableClustering && places.length > 0 ? (
          <MarkerClusterer options={CLUSTER_OPTIONS}>
            {(clusterer) => <>{renderMarkers(clusterer)}</>}
          </MarkerClusterer>
        ) : isMapLoaded ? (
          renderMarkers()
        ) : null}
      </GoogleMap>
    </div>
  );
}

/**
 * Get the current visible bounds of the map
 * Useful for implementing "search this area" feature
 */
export function useMapBounds(mapRef: React.RefObject<google.maps.Map | null>): MapBounds | null {
  const bounds = mapRef.current?.getBounds();
  if (!bounds) return null;

  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();

  return {
    north: ne.lat(),
    south: sw.lat(),
    east: ne.lng(),
    west: sw.lng(),
  };
}
