/**
 * List Collaboration - Invites, Roles, and Real-Time Sync
 *
 * Implements collaborative features for lists:
 * - Invite codes with expiration
 * - Role-based access (owner/editor/viewer)
 * - Collaborator management
 *
 * All modifications trigger Convex subscriptions for real-time sync.
 */

import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id, Doc } from "./_generated/dataModel";

// ============================================================================
// Types
// ============================================================================

export type CollaboratorRole = "owner" | "editor" | "viewer";
export type InviteRole = "editor" | "viewer";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a random invite code
 */
function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Get authenticated user from email
 */
async function getAuthUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.email) return null;

  const user = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", identity.email))
    .first();

  return user;
}

/**
 * Require authenticated user (throws if not authenticated)
 */
async function requireAuthUser(ctx: QueryCtx | MutationCtx) {
  const user = await getAuthUser(ctx);
  if (!user) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "Authentication required",
    });
  }
  return user;
}

/**
 * Check if user has access to a list with the required role
 */
async function checkListAccess(
  ctx: QueryCtx | MutationCtx,
  listId: Id<"lists">,
  userId: Id<"users">,
  requiredRole: "view" | "edit" | "owner"
): Promise<{ hasAccess: boolean; role: CollaboratorRole | null }> {
  const list = await ctx.db.get(listId);
  if (!list) {
    return { hasAccess: false, role: null };
  }

  // Owner always has full access
  if (list.userId === userId) {
    return { hasAccess: true, role: "owner" };
  }

  // Check collaborator role
  const collab = await ctx.db
    .query("listCollaborators")
    .withIndex("by_list_user", (q) => q.eq("listId", listId).eq("userId", userId))
    .first();

  if (!collab) {
    // Public lists allow viewing
    if (list.visibility === "public" && requiredRole === "view") {
      return { hasAccess: true, role: null };
    }
    return { hasAccess: false, role: null };
  }

  const role = collab.role as CollaboratorRole;

  // Check role hierarchy
  if (requiredRole === "owner" && role !== "owner") {
    return { hasAccess: false, role };
  }
  if (requiredRole === "edit" && role === "viewer") {
    return { hasAccess: false, role };
  }

  return { hasAccess: true, role };
}

/**
 * Require list access with specific role (throws if not authorized)
 */
async function requireListAccess(
  ctx: QueryCtx | MutationCtx,
  listId: Id<"lists">,
  requiredRole: "view" | "edit" | "owner"
): Promise<{ user: Doc<"users">; role: CollaboratorRole }> {
  const user = await requireAuthUser(ctx);
  const { hasAccess, role } = await checkListAccess(ctx, listId, user._id, requiredRole);

  if (!hasAccess) {
    const roleNames = { view: "view", edit: "edit", owner: "owner" };
    throw new ConvexError({
      code: "FORBIDDEN",
      message: `${roleNames[requiredRole]} access required for this list`,
    });
  }

  return { user, role: role || "viewer" };
}

// ============================================================================
// Invite Management
// ============================================================================

/**
 * Create an invite code for a list
 */
export const createInvite = mutation({
  args: {
    listId: v.id("lists"),
    role: v.union(v.literal("editor"), v.literal("viewer")),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireListAccess(ctx, args.listId, "owner");

    const list = await ctx.db.get(args.listId);
    if (!list) {
      throw new ConvexError({ code: "NOT_FOUND", message: "List not found" });
    }

    // Favorites cannot be shared
    if (list.type === "favorites") {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: "Favorites list cannot be shared",
      });
    }

    const expiresInDays = args.expiresInDays ?? 7;
    const expiresAt = Date.now() + expiresInDays * 24 * 60 * 60 * 1000;
    const inviteCode = generateInviteCode();

    await ctx.db.insert("listInvites", {
      listId: args.listId,
      inviteCode,
      role: args.role,
      createdByUserId: user._id,
      createdAt: Date.now(),
      expiresAt,
    });

    return {
      inviteCode,
      expiresAt,
      shareUrl: `/lists/join/${inviteCode}`,
    };
  },
});

/**
 * Accept an invite and join a list
 */
export const acceptInvite = mutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    // Find the invite
    const invite = await ctx.db
      .query("listInvites")
      .withIndex("by_code", (q) => q.eq("inviteCode", args.inviteCode.toUpperCase()))
      .first();

    if (!invite) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Invalid invite code",
      });
    }

    if (invite.expiresAt < Date.now()) {
      throw new ConvexError({
        code: "EXPIRED",
        message: "This invite has expired",
      });
    }

    // Check if user is already the owner
    const list = await ctx.db.get(invite.listId);
    if (!list) {
      throw new ConvexError({ code: "NOT_FOUND", message: "List not found" });
    }

    if (list.userId === user._id) {
      throw new ConvexError({
        code: "ALREADY_MEMBER",
        message: "You are the owner of this list",
      });
    }

    // Check if already a collaborator
    const existing = await ctx.db
      .query("listCollaborators")
      .withIndex("by_list_user", (q) => q.eq("listId", invite.listId).eq("userId", user._id))
      .first();

    if (existing) {
      throw new ConvexError({
        code: "ALREADY_MEMBER",
        message: "You are already a collaborator on this list",
      });
    }

    // Add as collaborator
    await ctx.db.insert("listCollaborators", {
      listId: invite.listId,
      userId: user._id,
      role: invite.role,
      createdAt: Date.now(),
    });

    return {
      listId: invite.listId,
      listName: list.name,
      role: invite.role,
    };
  },
});

/**
 * Get active invites for a list (owner only)
 */
export const getListInvites = query({
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];

    const list = await ctx.db.get(args.listId);
    if (!list || list.userId !== user._id) {
      return []; // Only owner can see invites
    }

    const invites = await ctx.db
      .query("listInvites")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();

    // Filter out expired invites
    const now = Date.now();
    return invites
      .filter((i) => i.expiresAt > now)
      .map((i) => ({
        _id: i._id,
        inviteCode: i.inviteCode,
        role: i.role,
        expiresAt: i.expiresAt,
        createdAt: i.createdAt,
      }));
  },
});

/**
 * Revoke an invite
 */
export const revokeInvite = mutation({
  args: { inviteId: v.id("listInvites") },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    const invite = await ctx.db.get(args.inviteId);
    if (!invite) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Invite not found" });
    }

    const list = await ctx.db.get(invite.listId);
    if (!list || list.userId !== user._id) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only the list owner can revoke invites",
      });
    }

    await ctx.db.delete(args.inviteId);
    return { success: true };
  },
});

// ============================================================================
// Collaborator Management
// ============================================================================

/**
 * Get collaborators for a list
 */
export const getCollaborators = query({
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];

    const list = await ctx.db.get(args.listId);
    if (!list) return [];

    // Only owner and collaborators can see the collaborator list
    const { hasAccess } = await checkListAccess(ctx, args.listId, user._id, "view");
    if (!hasAccess) return [];

    const collaborators = await ctx.db
      .query("listCollaborators")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();

    // Get user details for each collaborator
    const result = await Promise.all(
      collaborators.map(async (c) => {
        const collabUser = await ctx.db.get(c.userId);
        return {
          _id: c._id,
          userId: c.userId,
          role: c.role,
          name: collabUser?.name || collabUser?.email || "Unknown",
          image: collabUser?.image,
          createdAt: c.createdAt,
        };
      })
    );

    // Add owner to the list
    const owner = await ctx.db.get(list.userId);
    return [
      {
        _id: null as unknown as Id<"listCollaborators">,
        userId: list.userId,
        role: "owner",
        name: owner?.name || owner?.email || "Unknown",
        image: owner?.image,
        createdAt: list.createdAt,
        isOwner: true,
      },
      ...result.map((r) => ({ ...r, isOwner: false })),
    ];
  },
});

/**
 * Update a collaborator's role
 */
export const updateCollaboratorRole = mutation({
  args: {
    collaboratorId: v.id("listCollaborators"),
    role: v.union(v.literal("editor"), v.literal("viewer")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    const collab = await ctx.db.get(args.collaboratorId);
    if (!collab) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Collaborator not found" });
    }

    const list = await ctx.db.get(collab.listId);
    if (!list || list.userId !== user._id) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Only the list owner can change roles",
      });
    }

    await ctx.db.patch(args.collaboratorId, { role: args.role });
    return { success: true };
  },
});

/**
 * Remove a collaborator from a list
 */
export const removeCollaborator = mutation({
  args: { collaboratorId: v.id("listCollaborators") },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    const collab = await ctx.db.get(args.collaboratorId);
    if (!collab) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Collaborator not found" });
    }

    const list = await ctx.db.get(collab.listId);
    if (!list) {
      throw new ConvexError({ code: "NOT_FOUND", message: "List not found" });
    }

    // Owner can remove anyone, collaborators can only remove themselves
    if (list.userId !== user._id && collab.userId !== user._id) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You can only remove yourself or be the owner to remove others",
      });
    }

    await ctx.db.delete(args.collaboratorId);
    return { success: true };
  },
});

/**
 * Leave a list (for collaborators)
 */
export const leaveList = mutation({
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    const list = await ctx.db.get(args.listId);
    if (!list) {
      throw new ConvexError({ code: "NOT_FOUND", message: "List not found" });
    }

    // Owner cannot leave their own list
    if (list.userId === user._id) {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: "Owner cannot leave their own list. Transfer ownership or delete the list.",
      });
    }

    const collab = await ctx.db
      .query("listCollaborators")
      .withIndex("by_list_user", (q) => q.eq("listId", args.listId).eq("userId", user._id))
      .first();

    if (!collab) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "You are not a collaborator on this list",
      });
    }

    await ctx.db.delete(collab._id);
    return { success: true };
  },
});

// ============================================================================
// Queries for Collaborative Lists
// ============================================================================

/**
 * Get lists shared with the current user
 */
export const getSharedLists = query({
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];

    const collaborations = await ctx.db
      .query("listCollaborators")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const lists = await Promise.all(
      collaborations.map(async (c) => {
        const list = await ctx.db.get(c.listId);
        if (!list) return null;

        const owner = await ctx.db.get(list.userId);
        return {
          ...list,
          myRole: c.role,
          ownerName: owner?.name || owner?.email || "Unknown",
          ownerImage: owner?.image,
        };
      })
    );

    return lists.filter((l) => l !== null);
  },
});

/**
 * Get user's access level for a specific list
 */
export const getMyListAccess = query({
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) {
      return { hasAccess: false, role: null, isOwner: false };
    }

    const list = await ctx.db.get(args.listId);
    if (!list) {
      return { hasAccess: false, role: null, isOwner: false };
    }

    if (list.userId === user._id) {
      return { hasAccess: true, role: "owner" as const, isOwner: true };
    }

    const collab = await ctx.db
      .query("listCollaborators")
      .withIndex("by_list_user", (q) => q.eq("listId", args.listId).eq("userId", user._id))
      .first();

    if (collab) {
      return { hasAccess: true, role: collab.role, isOwner: false };
    }

    if (list.visibility === "public") {
      return { hasAccess: true, role: "viewer" as const, isOwner: false };
    }

    return { hasAccess: false, role: null, isOwner: false };
  },
});

// ============================================================================
// Export Access Control Helpers (for use in other modules)
// ============================================================================

export { checkListAccess, requireListAccess, getAuthUser, requireAuthUser };
