/**
 * Global Test Setup
 *
 * Configures the test environment:
 * - MSW server for API mocking
 * - Global test utilities
 * - Environment variables for tests
 */

import { beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { handlers } from "./mocks/handlers";

// Create MSW server with default handlers
export const server = setupServer(...handlers);

// Start MSW server before all tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: "warn" });
});

// Reset handlers after each test
afterEach(() => {
  server.resetHandlers();
});

// Clean up after all tests
afterAll(() => {
  server.close();
});

// Set test environment variables
Object.assign(process.env, {
  NEXT_PUBLIC_CONVEX_URL: "https://test.convex.cloud",
  PHOTO_SIGNING_SECRET: "test-signing-secret",
});
