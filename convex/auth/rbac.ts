/**
 * Role-Based Access Control (RBAC) Module
 *
 * Provides authentication and authorization helpers for the app.
 * All privileged mutations MUST use these helpers - never rely on client-side gating.
 *
 * Roles:
 * - admin: Full access, user management, system settings
 * - moderator: Review moderation, report handling, user warnings
 * - editor: Curated content, guides, place cards
 */

import { query, mutation, QueryCtx, MutationCtx } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";

// ============================================================================
// Types
// ============================================================================

export type Role = "admin" | "moderator" | "editor";

export interface AuthenticatedUser {
  userId: Id<"users">;
  email: string;
  name?: string;
}

export interface AuthorizedUser extends AuthenticatedUser {
  role: Role;
}

// ============================================================================
// Core Authentication Helper
// ============================================================================

/**
 * Get the currently authenticated user.
 * Throws if not authenticated.
 *
 * @param ctx - Query or Mutation context
 * @returns The authenticated user's ID and email
 */
export async function requireAuth(
  ctx: QueryCtx | MutationCtx
): Promise<AuthenticatedUser> {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "Authentication required",
    });
  }

  const userEmail = identity.email;
  if (!userEmail) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "User email not available",
    });
  }

  // Look up user by email
  const user = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", userEmail))
    .first();

  if (!user) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "User not found in database",
    });
  }

  return {
    userId: user._id,
    email: userEmail,
    name: user.name,
  };
}

/**
 * Get the current user if authenticated, or null if not.
 * Does not throw - use for optional auth checks.
 *
 * @param ctx - Query or Mutation context
 * @returns The authenticated user or null
 */
export async function getAuthUser(
  ctx: QueryCtx | MutationCtx
): Promise<AuthenticatedUser | null> {
  try {
    return await requireAuth(ctx);
  } catch {
    return null;
  }
}

// ============================================================================
// Role-Based Authorization
// ============================================================================

/**
 * Require the user to have one of the specified roles.
 * Throws if not authenticated or not authorized.
 *
 * @param ctx - Query or Mutation context
 * @param allowedRoles - Array of roles that are allowed
 * @returns The authorized user with their role
 */
export async function requireRole(
  ctx: QueryCtx | MutationCtx,
  allowedRoles: Role[]
): Promise<AuthorizedUser> {
  const user = await requireAuth(ctx);

  // Check user's role
  const userRole = await ctx.db
    .query("userRoles")
    .withIndex("by_user", (q) => q.eq("userId", user.userId))
    .first();

  if (!userRole) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "No role assigned to user",
    });
  }

  if (!allowedRoles.includes(userRole.role as Role)) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: `Access denied. Required roles: ${allowedRoles.join(", ")}`,
    });
  }

  return {
    ...user,
    role: userRole.role as Role,
  };
}

/**
 * Check if the current user has one of the specified roles.
 * Does not throw - returns boolean.
 *
 * @param ctx - Query or Mutation context
 * @param allowedRoles - Array of roles to check
 * @returns True if user has one of the roles, false otherwise
 */
export async function hasRole(
  ctx: QueryCtx | MutationCtx,
  allowedRoles: Role[]
): Promise<boolean> {
  try {
    await requireRole(ctx, allowedRoles);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current user's role, if any.
 *
 * @param ctx - Query or Mutation context
 * @returns The user's role or null if not authenticated/no role
 */
export async function getUserRole(
  ctx: QueryCtx | MutationCtx
): Promise<Role | null> {
  const user = await getAuthUser(ctx);
  if (!user) return null;

  const userRole = await ctx.db
    .query("userRoles")
    .withIndex("by_user", (q) => q.eq("userId", user.userId))
    .first();

  return userRole?.role as Role | null;
}

// ============================================================================
// Audit Logging
// ============================================================================

/**
 * Log a privileged action to the audit log.
 * Should be called after any admin/moderator/editor action.
 *
 * @param ctx - Mutation context
 * @param action - The action being performed (e.g., "review.softDelete")
 * @param targetType - The type of target (e.g., "review", "guide", "user")
 * @param targetKey - The identifier of the target
 * @param metadata - Optional additional data about the action
 */
export async function logAction(
  ctx: MutationCtx,
  action: string,
  targetType: string,
  targetKey: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const user = await requireAuth(ctx);

  await ctx.db.insert("auditLogs", {
    actorUserId: user.userId,
    action,
    targetType,
    targetKey,
    metadata: metadata ? JSON.stringify(metadata) : undefined,
    createdAt: Date.now(),
  });
}

// ============================================================================
// Exposed Queries and Mutations
// ============================================================================

/**
 * Get the current user's auth status and role
 */
export const getAuthStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    if (!user) {
      return { isAuthenticated: false, userId: null, role: null };
    }

    const role = await getUserRole(ctx);
    return {
      isAuthenticated: true,
      userId: user.userId,
      email: user.email,
      name: user.name,
      role,
    };
  },
});

/**
 * Get audit logs (admin only)
 */
export const getAuditLogs = query({
  args: {
    actorUserId: v.optional(v.id("users")),
    targetType: v.optional(v.string()),
    action: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Require admin role to view audit logs
    await requireRole(ctx, ["admin"]);

    const limit = args.limit ?? 100;

    // Build query
    let logsQuery;
    const actorUserId = args.actorUserId;
    if (actorUserId) {
      logsQuery = ctx.db
        .query("auditLogs")
        .withIndex("by_actor_recent", (q) => q.eq("actorUserId", actorUserId));
    } else {
      logsQuery = ctx.db.query("auditLogs");
    }

    const logs = await logsQuery.order("desc").take(limit);

    // Filter by targetType and action if specified
    let filtered = logs;
    if (args.targetType) {
      filtered = filtered.filter((log) => log.targetType === args.targetType);
    }
    if (args.action) {
      filtered = filtered.filter((log) => log.action === args.action);
    }

    // Resolve actor names
    const logsWithActors = await Promise.all(
      filtered.map(async (log) => {
        const actor = await ctx.db.get(log.actorUserId);
        return {
          ...log,
          actorName: actor?.name || actor?.email || "Unknown",
          parsedMetadata: log.metadata ? JSON.parse(log.metadata) : null,
        };
      })
    );

    return logsWithActors;
  },
});

/**
 * Assign a role to a user (admin only)
 */
export const assignRole = mutation({
  args: {
    targetUserId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("moderator"), v.literal("editor")),
  },
  handler: async (ctx, args) => {
    // Require admin role to assign roles
    const admin = await requireRole(ctx, ["admin"]);

    // Check if target user exists
    const targetUser = await ctx.db.get(args.targetUserId);
    if (!targetUser) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "User not found",
      });
    }

    // Check if user already has a role
    const existingRole = await ctx.db
      .query("userRoles")
      .withIndex("by_user", (q) => q.eq("userId", args.targetUserId))
      .first();

    if (existingRole) {
      // Update existing role
      await ctx.db.patch(existingRole._id, { role: args.role });
    } else {
      // Create new role assignment
      await ctx.db.insert("userRoles", {
        userId: args.targetUserId,
        role: args.role,
        createdAt: Date.now(),
      });
    }

    // Log the action
    await logAction(ctx, "role.assign", "user", args.targetUserId, {
      role: args.role,
      assignedBy: admin.userId,
    });

    return { success: true };
  },
});

/**
 * Remove a role from a user (admin only)
 */
export const removeRole = mutation({
  args: {
    targetUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Require admin role to remove roles
    const admin = await requireRole(ctx, ["admin"]);

    // Cannot remove your own role
    if (args.targetUserId === admin.userId) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Cannot remove your own role",
      });
    }

    // Find and delete the role
    const existingRole = await ctx.db
      .query("userRoles")
      .withIndex("by_user", (q) => q.eq("userId", args.targetUserId))
      .first();

    if (existingRole) {
      await ctx.db.delete(existingRole._id);

      // Log the action
      await logAction(ctx, "role.remove", "user", args.targetUserId, {
        previousRole: existingRole.role,
        removedBy: admin.userId,
      });
    }

    return { success: true };
  },
});

/**
 * List all users with roles (admin only)
 */
export const listRoleAssignments = query({
  args: {
    role: v.optional(v.union(v.literal("admin"), v.literal("moderator"), v.literal("editor"))),
  },
  handler: async (ctx, args) => {
    // Require admin role
    await requireRole(ctx, ["admin"]);

    let roleQuery;
    const filterRole = args.role;
    if (filterRole) {
      roleQuery = ctx.db
        .query("userRoles")
        .withIndex("by_role", (q) => q.eq("role", filterRole));
    } else {
      roleQuery = ctx.db.query("userRoles");
    }

    const roles = await roleQuery.collect();

    // Resolve user details
    const rolesWithUsers = await Promise.all(
      roles.map(async (role) => {
        const user = await ctx.db.get(role.userId);
        return {
          ...role,
          userName: user?.name,
          userEmail: user?.email,
        };
      })
    );

    return rolesWithUsers;
  },
});
