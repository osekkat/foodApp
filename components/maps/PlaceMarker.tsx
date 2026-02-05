"use client";

import { Marker } from "@react-google-maps/api";
import type { Clusterer } from "@react-google-maps/marker-clusterer";
import { useCallback, useMemo } from "react";

/**
 * Data required to display a place marker on the map
 */
export interface PlaceMarkerData {
  /** Unique identifier for the place */
  placeKey: string;
  /** Display name for the place */
  name: string;
  /** Location coordinates */
  location: {
    lat: number;
    lng: number;
  };
  /** Optional type for custom marker styling */
  placeType?: "restaurant" | "cafe" | "bakery" | "market" | "default";
  /** Optional rating for marker styling */
  rating?: number;
  /** Whether this place is a curated/featured place */
  isCurated?: boolean;
}

interface PlaceMarkerProps {
  place: PlaceMarkerData;
  onClick?: (placeKey: string) => void;
  clusterer?: Clusterer;
  /** Whether this marker is highlighted (hovered from sidebar) */
  isHighlighted?: boolean;
  /** Whether this marker is selected */
  isSelected?: boolean;
}

/**
 * Marker colors based on place type
 */
const MARKER_COLORS: Record<string, string> = {
  restaurant: "#E53E3E", // Red
  cafe: "#DD6B20", // Orange
  bakery: "#D69E2E", // Yellow
  market: "#38A169", // Green
  default: "#3182CE", // Blue
};

/**
 * Highlight/selected marker colors
 */
const HIGHLIGHT_COLOR = "#F97316"; // Orange for highlighted (sidebar hover)
const SELECTED_COLOR = "#6B46C1"; // Purple for selected

/**
 * Get marker icon configuration based on place data and state
 */
function getMarkerIcon(
  place: PlaceMarkerData,
  isHighlighted?: boolean,
  isSelected?: boolean
): google.maps.Symbol {
  // Determine color based on state
  let color: string;
  if (isSelected) {
    color = SELECTED_COLOR;
  } else if (isHighlighted) {
    color = HIGHLIGHT_COLOR;
  } else {
    color = MARKER_COLORS[place.placeType || "default"];
  }

  // Scale up for curated, highlighted, or selected markers
  let scale = place.isCurated ? 1.2 : 1;
  if (isHighlighted) scale *= 1.3;
  if (isSelected) scale *= 1.4;

  // Stroke weight increases for highlighted/selected
  const strokeWeight = isSelected ? 3 : isHighlighted ? 2.5 : 2;

  // Use a simple circle marker for performance
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: color,
    fillOpacity: isSelected || isHighlighted ? 1 : 0.9,
    strokeColor: "#ffffff",
    strokeWeight,
    scale: 10 * scale,
  };
}

/**
 * PlaceMarker displays a single place on the map.
 *
 * Features:
 * - Color-coded by place type
 * - Larger marker for curated places
 * - Click to select/view details
 * - Clusterable for performance
 * - Highlight state for sidebar hover sync
 * - Selected state for current selection
 */
export function PlaceMarker({
  place,
  onClick,
  clusterer,
  isHighlighted = false,
  isSelected = false,
}: PlaceMarkerProps) {
  const position = useMemo(
    () => ({
      lat: place.location.lat,
      lng: place.location.lng,
    }),
    [place.location.lat, place.location.lng]
  );

  const icon = useMemo(
    () => getMarkerIcon(place, isHighlighted, isSelected),
    [place, isHighlighted, isSelected]
  );

  const handleClick = useCallback(() => {
    onClick?.(place.placeKey);
  }, [onClick, place.placeKey]);

  // Higher z-index for highlighted/selected markers so they appear on top
  const zIndex = isSelected ? 1000 : isHighlighted ? 500 : undefined;

  return (
    <Marker
      position={position}
      icon={icon}
      title={place.name}
      onClick={handleClick}
      clusterer={clusterer}
      zIndex={zIndex}
    />
  );
}

/**
 * Custom marker for the currently selected place
 * Renders with distinct purple styling and higher z-index
 */
export function SelectedPlaceMarker({
  place,
}: {
  place: PlaceMarkerData;
}) {
  const position = useMemo(
    () => ({
      lat: place.location.lat,
      lng: place.location.lng,
    }),
    [place.location.lat, place.location.lng]
  );

  return (
    <Marker
      position={position}
      icon={{
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: "#6B46C1", // Purple for selected
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 3,
        scale: 14,
      }}
      title={place.name}
      zIndex={1000}
    />
  );
}
