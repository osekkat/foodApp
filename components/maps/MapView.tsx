"use client";

import { GoogleMap, MarkerClusterer } from "@react-google-maps/api";
import type { Clusterer } from "@react-google-maps/marker-clusterer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlaceMarker, type PlaceMarkerData } from "./PlaceMarker";
import { MOROCCO_MAP_STYLES } from "./mapStyles";
import { useMapContext } from "@/components/providers/MapProvider";

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
 * - Enable clustering when 3+ markers are nearby
 */
const CLUSTER_OPTIONS = {
  minimumClusterSize: 3,
  maxZoom: 15,
  gridSize: 60,
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
  /** Place key that is currently highlighted (e.g., from sidebar hover) */
  highlightedPlaceKey?: string | null;
  /** Place key that is currently selected */
  selectedPlaceKey?: string | null;
  /** Whether to show index numbers on markers (1, 2, 3...) */
  showIndices?: boolean;
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
  highlightedPlaceKey,
  selectedPlaceKey,
  showIndices = false,
}: MapViewProps) {
  const { isLoaded: isApiLoaded, loadError } = useMapContext();
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

  // Cleanup throttle timeout on unmount
  useEffect(() => {
    return () => {
      if (throttleRef.current) {
        clearTimeout(throttleRef.current);
      }
    };
  }, []);

  // Render markers with or without clustering
  const renderMarkers = useCallback(
    (clusterer?: Clusterer) => {
      return places.map((place) => (
        <PlaceMarker
          key={place.placeKey}
          place={place}
          onClick={handleMarkerClick}
          clusterer={clusterer}
          isHighlighted={highlightedPlaceKey === place.placeKey}
          isSelected={selectedPlaceKey === place.placeKey}
          showIndex={showIndices}
        />
      ));
    },
    [places, handleMarkerClick, highlightedPlaceKey, selectedPlaceKey, showIndices]
  );

  // Wait for the Google Maps script to load before rendering the map
  if (!isApiLoaded) {
    return (
      <div
        className={className}
        style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#f4f4f5" }}
      >
        <div style={{ textAlign: "center", color: "#71717a" }}>
          <div style={{ marginBottom: 8, fontSize: 14 }}>Loading map...</div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        className={className}
        style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#f4f4f5" }}
      >
        <div style={{ textAlign: "center", color: "#ef4444" }}>
          <div style={{ marginBottom: 4, fontWeight: 500 }}>Map failed to load</div>
          <div style={{ fontSize: 13, color: "#71717a" }}>Please try refreshing the page.</div>
        </div>
      </div>
    );
  }

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
