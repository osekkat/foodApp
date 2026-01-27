/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as cities from "../cities.js";
import type * as featureFlags from "../featureFlags.js";
import type * as fieldSets from "../fieldSets.js";
import type * as places from "../places.js";
import type * as providerGateway from "../providerGateway.js";
import type * as systemHealth from "../systemHealth.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  cities: typeof cities;
  featureFlags: typeof featureFlags;
  fieldSets: typeof fieldSets;
  places: typeof places;
  providerGateway: typeof providerGateway;
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
