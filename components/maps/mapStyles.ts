/**
 * Google Maps Style Configuration
 *
 * Custom map styling with Moroccan-inspired aesthetics:
 * - Warm earth tones reminiscent of Moroccan architecture
 * - Reduced visual clutter for better marker visibility
 * - Dark mode support with complementary colors
 */

/**
 * Light mode map styles - Moroccan earth tones
 */
export const MOROCCO_MAP_STYLES: google.maps.MapTypeStyle[] = [
  // Base map - soft cream background
  {
    elementType: "geometry",
    stylers: [{ color: "#f5f3ee" }],
  },
  // Labels - muted text
  {
    elementType: "labels.text.fill",
    stylers: [{ color: "#5a5245" }],
  },
  {
    elementType: "labels.text.stroke",
    stylers: [{ color: "#f5f3ee" }],
  },
  // Roads - subtle warm gray
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#e8e4db" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#d4cfc3" }],
  },
  // Highways - slightly darker
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#ddd7c9" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#c9c2b4" }],
  },
  // Water - Moroccan blue
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#a8ccd7" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#4a6d7c" }],
  },
  // Parks/green spaces - muted green
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#c8d9c4" }],
  },
  // Points of interest - hide most to reduce clutter
  {
    featureType: "poi.business",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "poi.attraction",
    stylers: [{ visibility: "simplified" }],
  },
  {
    featureType: "poi.government",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "poi.medical",
    stylers: [{ visibility: "simplified" }],
  },
  {
    featureType: "poi.school",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "poi.sports_complex",
    stylers: [{ visibility: "off" }],
  },
  // Transit - subtle visibility
  {
    featureType: "transit",
    stylers: [{ visibility: "simplified" }],
  },
  {
    featureType: "transit.station",
    elementType: "geometry",
    stylers: [{ color: "#ddd7c9" }],
  },
  // Administrative boundaries - very subtle
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#c9c2b4" }, { weight: 0.5 }],
  },
  // Landscape - natural areas
  {
    featureType: "landscape.natural",
    elementType: "geometry",
    stylers: [{ color: "#f0ece3" }],
  },
];

/**
 * Dark mode map styles - Moroccan night colors
 */
export const MOROCCO_MAP_STYLES_DARK: google.maps.MapTypeStyle[] = [
  // Base map - deep warm gray
  {
    elementType: "geometry",
    stylers: [{ color: "#1a1814" }],
  },
  // Labels - warm light text
  {
    elementType: "labels.text.fill",
    stylers: [{ color: "#c9bfa8" }],
  },
  {
    elementType: "labels.text.stroke",
    stylers: [{ color: "#1a1814" }],
  },
  // Roads - subtle warm gray
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#2d2920" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#1f1c17" }],
  },
  // Highways
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#3d3830" }],
  },
  // Water - deep Moroccan blue
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#1a3040" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#4a6d7c" }],
  },
  // Parks - muted dark green
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#1f2d1a" }],
  },
  // Hide most POIs
  {
    featureType: "poi.business",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "poi.attraction",
    stylers: [{ visibility: "simplified" }],
  },
  {
    featureType: "poi.government",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "poi.school",
    stylers: [{ visibility: "off" }],
  },
  // Transit
  {
    featureType: "transit",
    stylers: [{ visibility: "simplified" }],
  },
  // Administrative
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#3d3830" }, { weight: 0.5 }],
  },
];

/**
 * Minimal style for clustered view - even less visual noise
 */
export const MOROCCO_MAP_STYLES_MINIMAL: google.maps.MapTypeStyle[] = [
  ...MOROCCO_MAP_STYLES,
  // Additional simplifications for clustered view
  {
    featureType: "poi",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "transit",
    stylers: [{ visibility: "off" }],
  },
  {
    elementType: "labels.icon",
    stylers: [{ visibility: "off" }],
  },
];
