/**
 * MSW Handlers for Testing
 *
 * Mocks Google Places API responses for unit and integration tests.
 * IMPORTANT: Never use real API responses in tests - always mock.
 */

import { http, HttpResponse } from "msw";

// Mock place data (minimal, non-sensitive)
const mockPlace = {
  id: "test-place-id",
  displayName: { text: "Test Restaurant", languageCode: "en" },
  formattedAddress: "123 Test Street, Test City",
  location: { latitude: 31.6295, longitude: -7.9811 },
  primaryType: "restaurant",
  primaryTypeDisplayName: { text: "Restaurant" },
  rating: 4.5,
  userRatingCount: 100,
  priceLevel: "PRICE_LEVEL_MODERATE",
  regularOpeningHours: {
    openNow: true,
    weekdayDescriptions: [
      "Monday: 9:00 AM – 10:00 PM",
      "Tuesday: 9:00 AM – 10:00 PM",
      "Wednesday: 9:00 AM – 10:00 PM",
      "Thursday: 9:00 AM – 10:00 PM",
      "Friday: 9:00 AM – 11:00 PM",
      "Saturday: 10:00 AM – 11:00 PM",
      "Sunday: 10:00 AM – 9:00 PM",
    ],
  },
};

const mockSearchResult = {
  places: [
    mockPlace,
    {
      ...mockPlace,
      id: "test-place-id-2",
      displayName: { text: "Test Cafe", languageCode: "en" },
      primaryType: "cafe",
      primaryTypeDisplayName: { text: "Cafe" },
    },
  ],
};

const mockAutocompleteResult = {
  suggestions: [
    {
      placePrediction: {
        placeId: "test-place-id",
        text: { text: "Test Restaurant" },
        structuredFormat: {
          mainText: { text: "Test Restaurant" },
          secondaryText: { text: "123 Test Street, Test City" },
        },
        types: ["restaurant", "food", "establishment"],
      },
    },
  ],
};

export const handlers = [
  // Place Details
  http.get("https://places.googleapis.com/v1/places/:placeId", () => {
    return HttpResponse.json(mockPlace);
  }),

  // Text Search
  http.post("https://places.googleapis.com/v1/places:searchText", () => {
    return HttpResponse.json(mockSearchResult);
  }),

  // Autocomplete
  http.post("https://places.googleapis.com/v1/places:autocomplete", () => {
    return HttpResponse.json(mockAutocompleteResult);
  }),

  // Photo Media (returns photoUri)
  http.get(
    "https://places.googleapis.com/v1/places/:placeId/photos/:photoRef/media",
    () => {
      return HttpResponse.json({
        photoUri: "https://example.com/mock-photo.jpg",
      });
    }
  ),
];

// Handlers for error scenarios
export const errorHandlers = {
  rateLimited: http.get("https://places.googleapis.com/v1/places/:placeId", () => {
    return new HttpResponse(null, {
      status: 429,
      statusText: "Too Many Requests",
    });
  }),

  serverError: http.get("https://places.googleapis.com/v1/places/:placeId", () => {
    return new HttpResponse(null, {
      status: 500,
      statusText: "Internal Server Error",
    });
  }),

  notFound: http.get("https://places.googleapis.com/v1/places/:placeId", () => {
    return new HttpResponse(null, {
      status: 404,
      statusText: "Not Found",
    });
  }),
};
