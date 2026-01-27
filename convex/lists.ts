/**
 * User Lists - Favorites, Custom Collections, and Itineraries
 *
 * Implements the lists system with three list types:
 * - Favorites: Auto-created default list for quick saves
 * - Custom: User-created collections with name/description
 * - Itinerary: Ordered food crawls with time slots and notes
 *
 * POLICY: placeKey references only (never provider content)
 */

import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// ============================================================================
// Types
// ============================================================================

export type ListType = "favorites" | "custom" | "itinerary";
export type ListVisibility = "private" | "public";
export type TimeSlot = "breakfast" | "lunch" | "dinner" | "snack";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate URL-friendly slug from name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

/**
 * Get authenticated user ID (throws if not authenticated)
 */
async function requireAuth(ctx: { auth: { getUserIdentity: () => Promise<unknown> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Authentication required");
  }
  return identity;
}

// ============================================================================
// List CRUD
// ============================================================================

/**
 * Create a new list
 */
export const createList = mutation({
  args: {
    name: v.string(),
    type: v.union(v.literal("favorites"), v.literal("custom"), v.literal("itinerary")),
    visibility: v.union(v.literal("private"), v.literal("public")),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const tokenId = identity as { tokenIdentifier?: string };

    // Get or create user
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenId.tokenIdentifier ?? ""))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    // Generate slug for public lists
    const slug =
      args.visibility === "public" ? generateSlug(args.name) + "-" + Date.now().toString(36) : undefined;

    const listId = await ctx.db.insert("lists", {
      userId: user._id,
      name: args.name,
      type: args.type,
      visibility: args.visibility,
      description: args.description,
      slug,
      itemCount: 0,
      createdAt: Date.now(),
    });

    return listId;
  },
});

/**
 * Get user's lists
 */
export const getUserLists = query({
  args: {
    type: v.optional(v.union(v.literal("favorites"), v.literal("custom"), v.literal("itinerary"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }
    const tokenId = identity as { tokenIdentifier?: string };

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenId.tokenIdentifier ?? ""))
      .first();

    if (!user) {
      return [];
    }

    let lists = await ctx.db
      .query("lists")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Filter by type if specified
    if (args.type) {
      lists = lists.filter((list) => list.type === args.type);
    }

    return lists;
  },
});

/**
 * Get a specific list by ID
 */
export const getList = query({
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) return null;

    // Check visibility
    if (list.visibility === "private") {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) return null;
      const tokenId = identity as { tokenIdentifier?: string };

      const user = await ctx.db
        .query("users")
        .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenId.tokenIdentifier ?? ""))
        .first();

      if (!user || user._id !== list.userId) {
        return null; // Not the owner
      }
    }

    return list;
  },
});

/**
 * Get a public list by slug
 */
export const getListBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const list = await ctx.db
      .query("lists")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (!list || list.visibility !== "public") {
      return null;
    }

    return list;
  },
});

/**
 * Update list metadata
 */
export const updateList = mutation({
  args: {
    listId: v.id("lists"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    visibility: v.optional(v.union(v.literal("private"), v.literal("public"))),
    coverPhotoReference: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const tokenId = identity as { tokenIdentifier?: string };

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenId.tokenIdentifier ?? ""))
      .first();

    const list = await ctx.db.get(args.listId);
    if (!list) {
      throw new Error("List not found");
    }

    if (!user || list.userId !== user._id) {
      throw new Error("Not authorized to update this list");
    }

    // Cannot change favorites type
    if (list.type === "favorites" && args.visibility === "public") {
      throw new Error("Favorites list cannot be made public");
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.coverPhotoReference !== undefined) updates.coverPhotoReference = args.coverPhotoReference;

    // Handle visibility change
    if (args.visibility !== undefined && args.visibility !== list.visibility) {
      updates.visibility = args.visibility;
      if (args.visibility === "public" && !list.slug) {
        updates.slug = generateSlug(args.name ?? list.name) + "-" + Date.now().toString(36);
      }
    }

    await ctx.db.patch(args.listId, updates);
    return { success: true };
  },
});

/**
 * Delete a list
 */
export const deleteList = mutation({
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const tokenId = identity as { tokenIdentifier?: string };

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenId.tokenIdentifier ?? ""))
      .first();

    const list = await ctx.db.get(args.listId);
    if (!list) {
      throw new Error("List not found");
    }

    if (!user || list.userId !== user._id) {
      throw new Error("Not authorized to delete this list");
    }

    // Cannot delete favorites
    if (list.type === "favorites") {
      throw new Error("Cannot delete favorites list");
    }

    // Delete all items first
    const items = await ctx.db
      .query("listItems")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();

    for (const item of items) {
      await ctx.db.delete(item._id);
    }

    // Delete collaborators
    const collaborators = await ctx.db
      .query("listCollaborators")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();

    for (const collab of collaborators) {
      await ctx.db.delete(collab._id);
    }

    // Delete the list
    await ctx.db.delete(args.listId);

    return { success: true };
  },
});

// ============================================================================
// Favorites Helper
// ============================================================================

/**
 * Get or create user's favorites list
 */
export const getOrCreateFavorites = mutation({
  handler: async (ctx) => {
    const identity = await requireAuth(ctx);
    const tokenId = identity as { tokenIdentifier?: string };

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenId.tokenIdentifier ?? ""))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    // Check if favorites already exists
    const existingFavorites = await ctx.db
      .query("lists")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("type"), "favorites"))
      .first();

    if (existingFavorites) {
      return existingFavorites._id;
    }

    // Create favorites list
    const listId = await ctx.db.insert("lists", {
      userId: user._id,
      name: "Favorites",
      type: "favorites",
      visibility: "private",
      itemCount: 0,
      createdAt: Date.now(),
    });

    return listId;
  },
});

// ============================================================================
// List Items
// ============================================================================

/**
 * Add a place to a list
 */
export const addToList = mutation({
  args: {
    listId: v.id("lists"),
    placeKey: v.string(),
    timeSlot: v.optional(v.union(v.literal("breakfast"), v.literal("lunch"), v.literal("dinner"), v.literal("snack"))),
    itemNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const tokenId = identity as { tokenIdentifier?: string };

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenId.tokenIdentifier ?? ""))
      .first();

    const list = await ctx.db.get(args.listId);
    if (!list) {
      throw new Error("List not found");
    }

    // Check ownership (collaborator check would go here too)
    if (!user || list.userId !== user._id) {
      throw new Error("Not authorized to add to this list");
    }

    // Check if already in list
    const existing = await ctx.db
      .query("listItems")
      .withIndex("by_list_place", (q) => q.eq("listId", args.listId).eq("placeKey", args.placeKey))
      .first();

    if (existing) {
      throw new Error("Place already in list");
    }

    // Get next sort order
    const items = await ctx.db
      .query("listItems")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();

    const sortOrder = items.length;

    // Insert item
    const itemId = await ctx.db.insert("listItems", {
      listId: args.listId,
      placeKey: args.placeKey,
      sortOrder,
      timeSlot: args.timeSlot,
      itemNote: args.itemNote,
      createdAt: Date.now(),
    });

    // Update item count
    await ctx.db.patch(args.listId, {
      itemCount: items.length + 1,
      updatedAt: Date.now(),
    });

    return itemId;
  },
});

/**
 * Remove a place from a list
 */
export const removeFromList = mutation({
  args: {
    listId: v.id("lists"),
    placeKey: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const tokenId = identity as { tokenIdentifier?: string };

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenId.tokenIdentifier ?? ""))
      .first();

    const list = await ctx.db.get(args.listId);
    if (!list) {
      throw new Error("List not found");
    }

    if (!user || list.userId !== user._id) {
      throw new Error("Not authorized to remove from this list");
    }

    // Find and delete the item
    const item = await ctx.db
      .query("listItems")
      .withIndex("by_list_place", (q) => q.eq("listId", args.listId).eq("placeKey", args.placeKey))
      .first();

    if (!item) {
      throw new Error("Item not in list");
    }

    await ctx.db.delete(item._id);

    // Update item count
    await ctx.db.patch(args.listId, {
      itemCount: Math.max(0, list.itemCount - 1),
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Get items in a list
 */
export const getListItems = query({
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) return [];

    // Check visibility
    if (list.visibility === "private") {
      const identity = await ctx.auth.getUserIdentity();
      if (!identity) return [];
      const tokenId = identity as { tokenIdentifier?: string };

      const user = await ctx.db
        .query("users")
        .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenId.tokenIdentifier ?? ""))
        .first();

      if (!user || user._id !== list.userId) {
        return [];
      }
    }

    const items = await ctx.db
      .query("listItems")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();

    // Sort by sortOrder
    return items.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

/**
 * Check if a place is in a specific list
 */
export const isInList = query({
  args: {
    listId: v.id("lists"),
    placeKey: v.string(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db
      .query("listItems")
      .withIndex("by_list_place", (q) => q.eq("listId", args.listId).eq("placeKey", args.placeKey))
      .first();

    return item !== null;
  },
});

/**
 * Check if a place is in user's favorites
 */
export const isInFavorites = query({
  args: { placeKey: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;
    const tokenId = identity as { tokenIdentifier?: string };

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenId.tokenIdentifier ?? ""))
      .first();

    if (!user) return false;

    // Find favorites list
    const favoritesList = await ctx.db
      .query("lists")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("type"), "favorites"))
      .first();

    if (!favoritesList) return false;

    const item = await ctx.db
      .query("listItems")
      .withIndex("by_list_place", (q) => q.eq("listId", favoritesList._id).eq("placeKey", args.placeKey))
      .first();

    return item !== null;
  },
});

// ============================================================================
// Reordering (Drag and Drop)
// ============================================================================

/**
 * Reorder items in a list (for drag-and-drop)
 */
export const reorderListItems = mutation({
  args: {
    listId: v.id("lists"),
    itemIds: v.array(v.id("listItems")),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const tokenId = identity as { tokenIdentifier?: string };

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenId.tokenIdentifier ?? ""))
      .first();

    const list = await ctx.db.get(args.listId);
    if (!list) {
      throw new Error("List not found");
    }

    if (!user || list.userId !== user._id) {
      throw new Error("Not authorized to reorder this list");
    }

    // Update sort orders
    for (let i = 0; i < args.itemIds.length; i++) {
      const item = await ctx.db.get(args.itemIds[i]);
      if (item && item.listId === args.listId) {
        await ctx.db.patch(args.itemIds[i], { sortOrder: i });
      }
    }

    await ctx.db.patch(args.listId, { updatedAt: Date.now() });

    return { success: true };
  },
});

// ============================================================================
// Itinerary-specific
// ============================================================================

/**
 * Update item details (time slot, note)
 */
export const updateListItem = mutation({
  args: {
    itemId: v.id("listItems"),
    timeSlot: v.optional(
      v.union(v.literal("breakfast"), v.literal("lunch"), v.literal("dinner"), v.literal("snack"), v.null())
    ),
    itemNote: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const tokenId = identity as { tokenIdentifier?: string };

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenId.tokenIdentifier ?? ""))
      .first();

    const item = await ctx.db.get(args.itemId);
    if (!item) {
      throw new Error("Item not found");
    }

    const list = await ctx.db.get(item.listId);
    if (!list) {
      throw new Error("List not found");
    }

    if (!user || list.userId !== user._id) {
      throw new Error("Not authorized to update this item");
    }

    const updates: Record<string, unknown> = {};
    if (args.timeSlot !== undefined) {
      updates.timeSlot = args.timeSlot === null ? undefined : args.timeSlot;
    }
    if (args.itemNote !== undefined) {
      updates.itemNote = args.itemNote === null ? undefined : args.itemNote;
    }

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(args.itemId, updates);
      await ctx.db.patch(item.listId, { updatedAt: Date.now() });
    }

    return { success: true };
  },
});

// ============================================================================
// Toggle Favorite (Quick Action)
// ============================================================================

/**
 * Toggle a place in favorites (add if not there, remove if there)
 */
export const toggleFavorite = mutation({
  args: { placeKey: v.string() },
  handler: async (ctx, args) => {
    const identity = await requireAuth(ctx);
    const tokenId = identity as { tokenIdentifier?: string };

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenId.tokenIdentifier ?? ""))
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    // Get or create favorites list
    let favoritesList = await ctx.db
      .query("lists")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("type"), "favorites"))
      .first();

    if (!favoritesList) {
      const listId = await ctx.db.insert("lists", {
        userId: user._id,
        name: "Favorites",
        type: "favorites",
        visibility: "private",
        itemCount: 0,
        createdAt: Date.now(),
      });
      favoritesList = await ctx.db.get(listId);
    }

    if (!favoritesList) {
      throw new Error("Failed to create favorites list");
    }

    // Check if already in favorites
    const existing = await ctx.db
      .query("listItems")
      .withIndex("by_list_place", (q) => q.eq("listId", favoritesList._id).eq("placeKey", args.placeKey))
      .first();

    if (existing) {
      // Remove from favorites
      await ctx.db.delete(existing._id);
      await ctx.db.patch(favoritesList._id, {
        itemCount: Math.max(0, favoritesList.itemCount - 1),
        updatedAt: Date.now(),
      });
      return { added: false };
    } else {
      // Add to favorites
      const items = await ctx.db
        .query("listItems")
        .withIndex("by_list", (q) => q.eq("listId", favoritesList._id))
        .collect();

      await ctx.db.insert("listItems", {
        listId: favoritesList._id,
        placeKey: args.placeKey,
        sortOrder: items.length,
        createdAt: Date.now(),
      });

      await ctx.db.patch(favoritesList._id, {
        itemCount: favoritesList.itemCount + 1,
        updatedAt: Date.now(),
      });

      return { added: true };
    }
  },
});
