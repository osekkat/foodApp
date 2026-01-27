/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as auth_rbac from "../auth/rbac.js";
import type * as cities from "../cities.js";
import type * as crons from "../crons.js";
import type * as curatedPlaces from "../curatedPlaces.js";
import type * as featureFlags from "../featureFlags.js";
import type * as fieldSets from "../fieldSets.js";
import type * as http from "../http.js";
import type * as listCollaboration from "../listCollaboration.js";
import type * as lists from "../lists.js";
import type * as metrics from "../metrics.js";
import type * as placeDetails from "../placeDetails.js";
import type * as places from "../places.js";
import type * as profile from "../profile.js";
import type * as providerGateway from "../providerGateway.js";
import type * as rateLimit from "../rateLimit.js";
import type * as reviews from "../reviews.js";
import type * as serviceMode from "../serviceMode.js";
import type * as systemHealth from "../systemHealth.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  "auth/rbac": typeof auth_rbac;
  cities: typeof cities;
  crons: typeof crons;
  curatedPlaces: typeof curatedPlaces;
  featureFlags: typeof featureFlags;
  fieldSets: typeof fieldSets;
  http: typeof http;
  listCollaboration: typeof listCollaboration;
  lists: typeof lists;
  metrics: typeof metrics;
  placeDetails: typeof placeDetails;
  places: typeof places;
  profile: typeof profile;
  providerGateway: typeof providerGateway;
  rateLimit: typeof rateLimit;
  reviews: typeof reviews;
  serviceMode: typeof serviceMode;
  systemHealth: typeof systemHealth;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
