import User from "../Models/userModel.js";
import mongoose from "mongoose";
import { redisClient } from "../config/redis.js";
import { roleDataSchema, sidSchema } from "../validators/authSchema.js";

//GET ALL USERS
export const getAllUsers = async (req, res) => {
  const { sid } = req.signedCookies;
  const ownId = req.user._id;
  const { cursor } = req.query;

  let limit = parseInt(req.query.limit) || 10;
  if (limit > 50) {
    limit = 50;
  }

  if (cursor && !mongoose.isValidObjectId(cursor)) {
    return res.status(400).json({ error: "Invalid cursor" });
  }

  const parsed = sidSchema.safeParse(sid);
  if (!parsed.success) {
    res.clearCookie("sid", { httpOnly: true });
    return res.status(401).json({ error: "Invalid session" });
  }

  const query = { _id: { $ne: ownId } };

  if (cursor) {
    query._id = { ...query._id, $lt: cursor };
  }

  try {
    const allUsers = await User.find(query)
      .select("username _id email role isBlocked")
      .sort({ _id: -1 })
      .limit(limit)
      .lean();

    const nextCursor =
      allUsers.length > 0 ? allUsers[allUsers.length - 1]._id : null;

    return res.status(200).json({
      users: allUsers,
      nextCursor,
      hasMore: allUsers.length === limit,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to get users" });
  }
};

//GET USER SESSION STATUS
export const getSessionStatus = async (req, res) => {
  const { sid } = req.signedCookies;
  const { id: userId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: "User ID required" });
  }

  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  const parsed = sidSchema.safeParse(sid);
  if (!parsed.success) {
    res.clearCookie("sid", { httpOnly: true });
    return res.status(401).json({ error: "Invalid session" });
  }

  try {
    const session = await redisClient.ft.search(
      "userIdIndex",
      `@userId:{${userId}}`,
    );

    return res.status(200).json({ isLoggedIn: session.total > 0 });
  } catch (error) {
    return res.status(500).json({ error: "Failed to get users" });
  }
};

//ADMIN LOGOUT
export const adminLogout = async (req, res) => {
  const { userId } = req.body;

  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  try {
    const data = await redisClient.ft.search(
      "userIdIndex",
      `@userId:{${userId}}`,
    );

    if (!data.documents.length) {
      return res.status(404).json({ error: "No session found" });
    }

    const keys = data.documents.map((elem) => elem.id);

    await redisClient.del(keys);

    res.status(200).json({ message: "User logged out", userId });
  } catch (err) {
    res.status(400).json({ error: "Failed to logout user" });
  }
};

//ADMIN DELETE
export const adminDelete = async (req, res) => {
  const { userId } = req.body;

  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  const user = await User.findById({ _id: userId });
  if (!user) {
    return res.status(400).json({ error: "User not found!" });
  }
  try {
    const data = await redisClient.ft.search(
      "userIdIndex",
      `@userId:{${userId}}`,
    );

    const keys = data.documents.map((elem) => elem.id);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }

    await user.deleteOne();

    res.status(200).json({
      message: "User deleted successfully.",
    });
  } catch (error) {
    res.status(400).json({ error: "failed to delete user" });
  }
};

//ADMIN BLOCK
export const adminBlock = async (req, res) => {
  const { userId } = req.body;

  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  const user = await User.findById({ _id: userId });

  if (!user) {
    return res.status(400).json({ error: "User not found!" });
  }

  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Insufficient permission" });
  }

  if (!user.isBlocked) {
    const data = await redisClient.ft.search(
      "userIdIndex",
      `@userId:{${userId}}`,
    );

    const keys = data.documents.map((elem) => elem.id);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
    user.isBlocked = true;
    await user.save();
    return res.status(200).json({ message: `${user.username} is blocked` });
  } else {
    user.isBlocked = false;
    await user.save();
    return res.status(200).json({ message: `${user.username} is unblocked` });
  }
};

//ROLE CHANGE
export const changeRole = async (req, res) => {
  const ownRole = req.user.role;
  const roleData = req.body;

  const { success, data, error } = roleDataSchema.safeParse(roleData);

  if (!success) {
    return res.status(400).json({ error: error.issues[0].message });
  }

  const { userId, changeTo } = data;

  const user = await User.findById(userId);

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  //OWN ROLE CHANGE CASE
  if (req.user._id.toString() === userId) {
    return res.status(403).json({ error: "You can't change your own role" });
  }

  //ADMIN CHECK
  if (ownRole !== "ADMIN") {
    return res.status(403).json({ error: "Insufficient permission" });
  }

  const roleRank = {
    STUDENT: 1,
    CREATOR: 2,
    ADMIN: 3,
  };

  if (roleRank[ownRole] <= roleRank[user.role]) {
    return res.status(403).json({ error: "Insufficient permission" });
  }

  if (roleRank[changeTo] > roleRank[ownRole]) {
    return res.status(403).json({ error: "Cannot assign this role" });
  }

  try {
    user.role = changeTo;
    await user.save();

    //CACHE INVALIDATION FOR ROLE MISMATCH
    await redisClient.del(`profile:${userId}`);

    const data = await redisClient.ft.search(
      "userIdIndex",
      `@userId:{${userId}}`,
    );

    const keys = data.documents.map((elem) => elem.id);

    if (keys.length > 0) {
      await redisClient.del(keys);
    }

    res.status(200).json({ message: "User role changed successfully" });
  } catch (error) {
    res.status(400).json({ error: "Failed to update user role" });
  }
};
