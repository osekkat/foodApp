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
  /** Optional index number to display on the marker (1-based) */
  index?: number;
}

interface PlaceMarkerProps {
  place: PlaceMarkerData;
  onClick?: (placeKey: string) => void;
  clusterer?: Clusterer;
  /** Whether this marker is highlighted (hovered from sidebar) */
  isHighlighted?: boolean;
  /** Whether this marker is selected */
  isSelected?: boolean;
  /** Whether to show index numbers on markers */
  showIndex?: boolean;
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
 * Generate an SVG data URL for a numbered marker
 */
function createNumberedMarkerSvg(
  number: number,
  fillColor: string,
  strokeColor: string = "#ffffff",
  strokeWidth: number = 2,
  size: number = 32
): string {
  // Adjust font size based on number of digits
  const fontSize = number > 99 ? 11 : number > 9 ? 13 : 14;
  
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - strokeWidth}" 
        fill="${fillColor}" 
        stroke="${strokeColor}" 
        stroke-width="${strokeWidth}"/>
      <text x="${size / 2}" y="${size / 2}" 
        text-anchor="middle" 
        dominant-baseline="central" 
        fill="${strokeColor}" 
        font-family="system-ui, -apple-system, sans-serif" 
        font-weight="600" 
        font-size="${fontSize}px">${number}</text>
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/**
 * Get marker icon configuration based on place data and state
 * Returns either a Symbol (for non-numbered) or Icon (for numbered markers)
 */
function getMarkerIcon(
  place: PlaceMarkerData,
  isHighlighted?: boolean,
  isSelected?: boolean,
  showIndex?: boolean
): google.maps.Symbol | google.maps.Icon {
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

  // If showing index and we have one, use numbered marker
  if (showIndex && place.index !== undefined && place.index > 0) {
    const baseSize = 28;
    const size = Math.round(baseSize * scale);
    const strokeWeight = isSelected ? 3 : isHighlighted ? 2.5 : 2;
    
    return {
      url: createNumberedMarkerSvg(place.index, color, "#ffffff", strokeWeight, size),
      scaledSize: new google.maps.Size(size, size),
      anchor: new google.maps.Point(size / 2, size / 2),
    };
  }

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
 * - Optional numbered labels (1, 2, 3...) matching sidebar order
 */
export function PlaceMarker({
  place,
  onClick,
  clusterer,
  isHighlighted = false,
  isSelected = false,
  showIndex = false,
}: PlaceMarkerProps) {
  const position = useMemo(
    () => ({
      lat: place.location.lat,
      lng: place.location.lng,
    }),
    [place.location.lat, place.location.lng]
  );

  const icon = useMemo(
    () => getMarkerIcon(place, isHighlighted, isSelected, showIndex),
    [place, isHighlighted, isSelected, showIndex]
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
