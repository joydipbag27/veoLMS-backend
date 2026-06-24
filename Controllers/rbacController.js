import User from "../Models/userModel.js";
import mongoose from "mongoose";
import { redisClient } from "../config/redis.js";
import { roleDataSchema, sidSchema } from "../validators/authSchema.js";
import { successResponse, errorResponse } from "../utils/response.js";

// GET ALL USERS
export const getAllUsers = async (req, res) => {
  const { sid } = req.signedCookies;
  const ownId = req.user._id;
  const { cursor } = req.query;

  let limit = Math.min(parseInt(req.query.limit) || 10, 50);

  if (cursor && !mongoose.isValidObjectId(cursor)) {
    return errorResponse(res, 400, "Invalid cursor");
  }

  const parsed = sidSchema.safeParse(sid);
  if (!parsed.success) {
    res.clearCookie("sid", { httpOnly: true });
    return errorResponse(res, 401, "Invalid session");
  }

  const query = { _id: { $ne: ownId } };
  if (cursor) query._id = { ...query._id, $lt: cursor };

  try {
    const allUsers = await User.find(query)
      .select("username _id email role isBlocked")
      .sort({ _id: -1 })
      .limit(limit)
      .lean();

    const nextCursor = allUsers.length > 0 ? allUsers[allUsers.length - 1]._id : null;

    return successResponse(res, 200, "Users fetched", {
      users: allUsers,
      nextCursor,
      hasMore: allUsers.length === limit,
    });
  } catch (err) {
    console.error("[getAllUsers] Unexpected error:", err);
    return errorResponse(res, 500, "Failed to fetch users");
  }
};

// GET USER SESSION STATUS
export const getSessionStatus = async (req, res) => {
  const { sid } = req.signedCookies;
  const { id: userId } = req.params;

  if (!userId) return errorResponse(res, 400, "User ID required");
  if (!mongoose.isValidObjectId(userId)) return errorResponse(res, 400, "Invalid userId");

  const parsed = sidSchema.safeParse(sid);
  if (!parsed.success) {
    res.clearCookie("sid", { httpOnly: true });
    return errorResponse(res, 401, "Invalid session");
  }

  try {
    const session = await redisClient.ft.search("userIdIndex", `@userId:{${userId}}`);
    return successResponse(res, 200, "Session status fetched", { isLoggedIn: session.total > 0 });
  } catch (err) {
    console.error("[getSessionStatus] Unexpected error:", err);
    return errorResponse(res, 500, "Failed to get session status");
  }
};

// ADMIN LOGOUT
export const adminLogout = async (req, res) => {
  const { userId } = req.body;
  if (!mongoose.isValidObjectId(userId)) return errorResponse(res, 400, "Invalid userId");

  try {
    const data = await redisClient.ft.search("userIdIndex", `@userId:{${userId}}`);
    if (!data.documents.length) return errorResponse(res, 404, "No active session found for this user");

    const keys = data.documents.map((elem) => elem.id);
    await redisClient.del(keys);

    return successResponse(res, 200, "User logged out", { userId });
  } catch (err) {
    console.error("[adminLogout] Unexpected error:", err);
    return errorResponse(res, 500, "Failed to logout user");
  }
};

// ADMIN DELETE
export const adminDelete = async (req, res) => {
  const { userId } = req.body;
  if (!mongoose.isValidObjectId(userId)) return errorResponse(res, 400, "Invalid userId");

  try {
    const user = await User.findById(userId);
    if (!user) return errorResponse(res, 404, "User not found");

    const data = await redisClient.ft.search("userIdIndex", `@userId:{${userId}}`);
    const keys = data.documents.map((elem) => elem.id);
    if (keys.length > 0) await redisClient.del(keys);

    await user.deleteOne();
    return successResponse(res, 200, "User deleted successfully");
  } catch (err) {
    console.error("[adminDelete] Unexpected error:", err);
    return errorResponse(res, 500, "Failed to delete user");
  }
};

// ADMIN BLOCK / UNBLOCK
export const adminBlock = async (req, res) => {
  const { userId } = req.body;
  if (!mongoose.isValidObjectId(userId)) return errorResponse(res, 400, "Invalid userId");

  try {
    const user = await User.findById(userId);
    if (!user) return errorResponse(res, 404, "User not found");

    if (!user.isBlocked) {
      // Block: force-logout all sessions
      const data = await redisClient.ft.search("userIdIndex", `@userId:{${userId}}`);
      const keys = data.documents.map((elem) => elem.id);
      if (keys.length > 0) await redisClient.del(keys);

      user.isBlocked = true;
      await user.save();
      return successResponse(res, 200, `${user.username} has been blocked`);
    } else {
      user.isBlocked = false;
      await user.save();
      return successResponse(res, 200, `${user.username} has been unblocked`);
    }
  } catch (err) {
    console.error("[adminBlock] Unexpected error:", err);
    return errorResponse(res, 500, "Failed to update user block status");
  }
};

// CHANGE ROLE
export const changeRole = async (req, res) => {
  const ownRole = req.user.role;
  const { success, data, error } = roleDataSchema.safeParse(req.body);
  if (!success) return errorResponse(res, 400, error.issues[0].message);

  const { userId, changeTo } = data;

  try {
    const user = await User.findById(userId);
    if (!user) return errorResponse(res, 404, "User not found");

    if (req.user._id.toString() === userId) {
      return errorResponse(res, 403, "You cannot change your own role");
    }

    if (ownRole !== "ADMIN") return errorResponse(res, 403, "Insufficient permissions");

    const roleRank = { STUDENT: 1, CREATOR: 2, ADMIN: 3 };

    if (roleRank[ownRole] <= roleRank[user.role]) {
      return errorResponse(res, 403, "You cannot change the role of a user with equal or higher rank");
    }

    if (roleRank[changeTo] > roleRank[ownRole]) {
      return errorResponse(res, 403, "Cannot assign a role higher than your own");
    }

    user.role = changeTo;
    await user.save();

    // Invalidate profile cache and force re-login for role to take effect
    await redisClient.del(`profile:${userId}`);
    const sessions = await redisClient.ft.search("userIdIndex", `@userId:{${userId}}`);
    const keys = sessions.documents.map((elem) => elem.id);
    if (keys.length > 0) await redisClient.del(keys);

    return successResponse(res, 200, "User role updated successfully");
  } catch (err) {
    console.error("[changeRole] Unexpected error:", err);
    return errorResponse(res, 500, "Failed to update user role");
  }
};
