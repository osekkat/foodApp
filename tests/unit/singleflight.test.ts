/**
 * Tests for Singleflight Request Coalescing
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  singleflight,
  singleflightSimple,
  detailsKey,
  searchKey,
  photoKey,
  autocompleteKey,
  getStats,
  resetStats,
  getHitRate,
  isInFlight,
  getActiveCount,
  _clearInFlight,
  _getInFlightKeys,
} from "../../lib/singleflight";

describe("Singleflight Core", () => {
  beforeEach(() => {
    resetStats();
    _clearInFlight();
  });

  describe("basic coalescing", () => {
    it("should execute operation for first caller", async () => {
      const operation = vi.fn().mockResolvedValue("result");

      const result = await singleflight("test-key", operation);

      expect(result.data).toBe("result");
      expect(result.shared).toBe(false);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should share result for concurrent identical requests", async () => {
      let resolveOperation: (value: string) => void;
      const operationPromise = new Promise<string>((resolve) => {
        resolveOperation = resolve;
      });
      const operation = vi.fn().mockReturnValue(operationPromise);

      // Start two concurrent requests
      const promise1 = singleflight("shared-key", operation);
      const promise2 = singleflight("shared-key", operation);

      // Operation should only be called once
      expect(operation).toHaveBeenCalledTimes(1);

      // Resolve the operation
      resolveOperation!("shared-result");

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Both should get the result
      expect(result1.data).toBe("shared-result");
      expect(result2.data).toBe("shared-result");

      // First caller was not shared, second was
      expect(result1.shared).toBe(false);
      expect(result2.shared).toBe(true);
    });

    it("should not share between different keys", async () => {
      const operation1 = vi.fn().mockResolvedValue("result1");
      const operation2 = vi.fn().mockResolvedValue("result2");

      const [result1, result2] = await Promise.all([
        singleflight("key1", operation1),
        singleflight("key2", operation2),
      ]);

      expect(result1.data).toBe("result1");
      expect(result2.data).toBe("result2");
      expect(operation1).toHaveBeenCalledTimes(1);
      expect(operation2).toHaveBeenCalledTimes(1);
    });
  });

  describe("sequential requests", () => {
    it("should make new request after previous completes", async () => {
      const operation = vi.fn().mockResolvedValue("result");

      const result1 = await singleflight("seq-key", operation);
      const result2 = await singleflight("seq-key", operation);

      expect(result1.data).toBe("result");
      expect(result2.data).toBe("result");
      // Both should NOT be shared since they're sequential
      expect(result1.shared).toBe(false);
      expect(result2.shared).toBe(false);
      expect(operation).toHaveBeenCalledTimes(2);
    });
  });

  describe("error handling", () => {
    it("should propagate errors to all waiters", async () => {
      let rejectOperation: (error: Error) => void;
      const operationPromise = new Promise<string>((_, reject) => {
        rejectOperation = reject;
      });
      const operation = vi.fn().mockReturnValue(operationPromise);

      const promise1 = singleflight("error-key", operation);
      const promise2 = singleflight("error-key", operation);

      // Reject the operation
      rejectOperation!(new Error("Test error"));

      await expect(promise1).rejects.toThrow("Test error");
      await expect(promise2).rejects.toThrow("Test error");
    });

    it("should clean up after error", async () => {
      const failOperation = vi.fn().mockRejectedValue(new Error("fail"));
      const successOperation = vi.fn().mockResolvedValue("success");

      try {
        await singleflight("cleanup-key", failOperation);
      } catch {
        // Expected
      }

      // Should be able to make new request with same key
      const result = await singleflight("cleanup-key", successOperation);
      expect(result.data).toBe("success");
      expect(successOperation).toHaveBeenCalledTimes(1);
    });
  });

  describe("singleflightSimple", () => {
    it("should return data without shared flag", async () => {
      const operation = vi.fn().mockResolvedValue("simple-result");

      const result = await singleflightSimple("simple-key", operation);

      expect(result).toBe("simple-result");
    });
  });
});

describe("Key Generation", () => {
  describe("detailsKey", () => {
    it("should generate consistent key for place details", () => {
      const key = detailsKey({
        placeId: "ChIJ123abc",
        fieldSet: "PLACE_HEADER",
        language: "en",
        region: "MA",
      });

      expect(key).toBe("details:ChIJ123abc:PLACE_HEADER:en:MA");
    });

    it("should generate different keys for different params", () => {
      const key1 = detailsKey({
        placeId: "ChIJ123",
        fieldSet: "BASIC",
        language: "en",
        region: "MA",
      });
      const key2 = detailsKey({
        placeId: "ChIJ123",
        fieldSet: "BASIC",
        language: "fr",
        region: "MA",
      });

      expect(key1).not.toBe(key2);
    });
  });

  describe("searchKey", () => {
    it("should generate key for basic search", () => {
      const key = searchKey({
        query: "tagine",
        fieldSet: "SEARCH_LITE",
        language: "en",
        region: "MA",
      });

      expect(key).toBe("search:tagine:SEARCH_LITE:en:MA");
    });

    it("should normalize query case and whitespace", () => {
      const key1 = searchKey({
        query: "Tagine  ",
        fieldSet: "SEARCH_LITE",
        language: "en",
        region: "MA",
      });
      const key2 = searchKey({
        query: "  tagine",
        fieldSet: "SEARCH_LITE",
        language: "en",
        region: "MA",
      });

      expect(key1).toBe(key2);
    });

    it("should include location bias with rounded coordinates", () => {
      const key = searchKey({
        query: "cafe",
        fieldSet: "SEARCH_LITE",
        language: "en",
        region: "MA",
        locationBias: {
          lat: 31.62873456,
          lng: -7.99218765,
          radiusMeters: 5000,
        },
      });

      // Coordinates should be rounded to 3 decimal places
      expect(key).toBe("search:cafe:SEARCH_LITE:en:MA:loc:31.629,-7.992,5000");
    });

    it("should handle nearby coordinates as same key", () => {
      // Two points within rounding distance should get same key
      // At 3 decimal places, coords within 0.0005 round to same value
      const key1 = searchKey({
        query: "food",
        fieldSet: "SEARCH_LITE",
        language: "en",
        region: "MA",
        locationBias: { lat: 31.6282, lng: -7.9922, radiusMeters: 1000 },
      });
      const key2 = searchKey({
        query: "food",
        fieldSet: "SEARCH_LITE",
        language: "en",
        region: "MA",
        locationBias: { lat: 31.6284, lng: -7.9919, radiusMeters: 1000 },
      });

      expect(key1).toBe(key2);
    });
  });

  describe("photoKey", () => {
    it("should generate key for photo request", () => {
      const key = photoKey({
        photoRef: "Aap_uEBpZ3...abc123",
        maxWidth: 400,
        maxHeight: 300,
      });

      expect(key).toBe("photo:Aap_uEBpZ3...abc123:400x300");
    });
  });

  describe("autocompleteKey", () => {
    it("should generate key for autocomplete", () => {
      const key = autocompleteKey({
        input: "taj",
        language: "en",
        region: "MA",
      });

      expect(key).toBe("autocomplete:taj:en:MA");
    });

    it("should NOT include sessionToken in key", () => {
      const key1 = autocompleteKey({
        input: "cafe",
        sessionToken: "token-123",
        language: "en",
        region: "MA",
      });
      const key2 = autocompleteKey({
        input: "cafe",
        sessionToken: "token-456",
        language: "en",
        region: "MA",
      });

      // Same input should produce same key regardless of session token
      expect(key1).toBe(key2);
    });

    it("should include location bias", () => {
      const key = autocompleteKey({
        input: "res",
        language: "fr",
        region: "MA",
        locationBias: { lat: 33.5731, lng: -7.5898, radiusMeters: 10000 },
      });

      expect(key).toBe("autocomplete:res:fr:MA:loc:33.573,-7.59,10000");
    });
  });
});

describe("Metrics", () => {
  beforeEach(() => {
    resetStats();
    _clearInFlight();
  });

  describe("getStats", () => {
    it("should track hits and misses", async () => {
      let resolve: (v: string) => void;
      const pending = new Promise<string>((r) => {
        resolve = r;
      });
      const operation = vi.fn().mockReturnValue(pending);

      // First call = miss
      const p1 = singleflight("stats-key", operation);
      // Second call = hit (while first is in flight)
      const p2 = singleflight("stats-key", operation);

      expect(getStats()).toEqual({
        hits: 1,
        misses: 1,
        active: 1,
      });

      resolve!("done");
      await Promise.all([p1, p2]);

      expect(getStats()).toEqual({
        hits: 1,
        misses: 1,
        active: 0,
      });
    });
  });

  describe("getHitRate", () => {
    it("should calculate hit rate percentage", async () => {
      const operation = vi.fn().mockResolvedValue("x");

      // 1 miss
      await singleflight("hr1", operation);
      expect(getHitRate()).toBe(0);

      // Another miss
      await singleflight("hr2", operation);
      expect(getHitRate()).toBe(0);

      // Now do a concurrent request
      let resolve: (v: string) => void;
      const pending = new Promise<string>((r) => {
        resolve = r;
      });
      const slowOp = vi.fn().mockReturnValue(pending);

      const p1 = singleflight("hr3", slowOp);
      const p2 = singleflight("hr3", slowOp); // hit

      resolve!("done");
      await Promise.all([p1, p2]);

      // 1 hit, 3 misses = 25%
      expect(getHitRate()).toBe(25);
    });

    it("should return 0 when no requests made", () => {
      expect(getHitRate()).toBe(0);
    });
  });

  describe("isInFlight", () => {
    it("should report if key is currently in flight", async () => {
      let resolve: (v: string) => void;
      const pending = new Promise<string>((r) => {
        resolve = r;
      });
      const operation = vi.fn().mockReturnValue(pending);

      const promise = singleflight("flight-check", operation);

      expect(isInFlight("flight-check")).toBe(true);
      expect(isInFlight("other-key")).toBe(false);

      resolve!("done");
      await promise;

      expect(isInFlight("flight-check")).toBe(false);
    });
  });

  describe("getActiveCount", () => {
    it("should return number of active in-flight requests", async () => {
      expect(getActiveCount()).toBe(0);

      let resolve1: (v: string) => void;
      let resolve2: (v: string) => void;
      const pending1 = new Promise<string>((r) => {
        resolve1 = r;
      });
      const pending2 = new Promise<string>((r) => {
        resolve2 = r;
      });

      const p1 = singleflight("active1", () => pending1);
      expect(getActiveCount()).toBe(1);

      const p2 = singleflight("active2", () => pending2);
      expect(getActiveCount()).toBe(2);

      resolve1!("done");
      await p1;
      expect(getActiveCount()).toBe(1);

      resolve2!("done");
      await p2;
      expect(getActiveCount()).toBe(0);
    });
  });
});

describe("Edge Cases", () => {
  beforeEach(() => {
    resetStats();
    _clearInFlight();
  });

  it("should handle many concurrent requests to same key", async () => {
    let resolve: (v: string) => void;
    const pending = new Promise<string>((r) => {
      resolve = r;
    });
    const operation = vi.fn().mockReturnValue(pending);

    // Start 100 concurrent requests
    const promises = Array(100)
      .fill(null)
      .map(() => singleflight("mass-key", operation));

    // Operation should only be called once
    expect(operation).toHaveBeenCalledTimes(1);
    expect(getActiveCount()).toBe(1);

    resolve!("mass-result");
    const results = await Promise.all(promises);

    // All should get the result
    expect(results.every((r) => r.data === "mass-result")).toBe(true);
    // First was not shared, rest were
    expect(results.filter((r) => r.shared).length).toBe(99);
    expect(results.filter((r) => !r.shared).length).toBe(1);
  });

  it("should handle rapid sequential requests", async () => {
    const operation = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 1)); // Tiny delay
      return "seq-result";
    });

    // Rapid sequential (not concurrent) requests
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await singleflight(`rapid-${i}`, operation));
    }

    expect(results.length).toBe(5);
    expect(operation).toHaveBeenCalledTimes(5); // Each should make its own call
  });

  it("should handle special characters in keys", async () => {
    const operation = vi.fn().mockResolvedValue("special");

    const result = await singleflight(
      "search:café%20🍵:SEARCH_LITE:ar:MA",
      operation
    );

    expect(result.data).toBe("special");
  });
});
