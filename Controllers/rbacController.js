import User from "../Models/userModel.js";
import File from "../Models/fileModel.js";
import Share from "../Models/shareModel.js";
import Directory from "../Models/directoryModel.js";
import mongoose from "mongoose";
import { redisClient } from "../config/redis.js";
import {
  dirAndFileNameSchema,
  roleDataSchema,
  sidSchema,
  sortSchema,
} from "../validators/authSchema.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import {
  permanentlyDeleteMultipleFromB2,
  s3Client,
} from "../config/s3Client.js";
import { deleteThumbnail } from "../services/thumbnailService.js";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { handleCursorPagination } from "../utils/pagination.js";
import {
  directoryCursorConfig,
  fileCursorConfig,
} from "../utils/cursorConfig.js";
import { directorySortMap, fileSortMap } from "../utils/sortMap.js";

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
  const session = await mongoose.startSession();

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

    session.startTransaction();

    await Directory.deleteMany({ userId }, { session });

    const files = await File.find({ userId });

    await Share.deleteMany({
      ownerId: userId,
    });

    await File.deleteMany({ userId }, { session });
    await user.deleteOne({ session });

    await session.commitTransaction();

    const haveToDeleteFilesFullNames = files.map(
      (elem) => `${elem._id.toString()}${elem.extension}`,
    );

    const imageFiles = files.filter((file) => file.fileType === "image" || file.fileType === "video");
    if (imageFiles.length > 0) {
      await Promise.all(
        imageFiles.map((file) =>
          deleteThumbnail(
            file._id.toString(),
            userId.toString(),
            file.extension,
          ),
        ),
      );
    }

    // FILESYSTEM CLEANUP (OUTSIDE TRANSACTION)
    if (haveToDeleteFilesFullNames.length > 0) {
      await permanentlyDeleteMultipleFromB2(haveToDeleteFilesFullNames);
    }

    res.status(200).json({
      message: "User and all associated assets deleted successfully.",
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ error: "failed to delete user" });
  } finally {
    session.endSession();
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

  if (!user.isBlocked && (req.user.role === "Admin" || "Owner")) {
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
    res.status(200).json({ message: `${user.username} is blocked` });
  } else if (user.isBlocked && req.user.role === "Admin") {
    res
      .status(400)
      .json({ error: "You don't have permission to unblock a user" });
  } else if (user.isBlocked && req.user.role === "Owner") {
    user.isBlocked = false;
    await user.save();
    res.status(200).json({ message: `${user.username} is unblocked` });
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

  //USER CASE
  if (ownRole === "User") {
    return res.status(403).json({ error: "Insufficient permission" });
  }

  const roleRank = {
    User: 1,
    Manager: 2,
    Admin: 3,
    Owner: 4,
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

    await redisClient.del(keys);

    res.status(200).json({ message: "User role changed successfully" });
  } catch (error) {
    res.status(400).json({ error: "Failed to update user role" });
  }
};

// ------- RBAC FILE SYSTEM -------- //

//USERS DIRECTORY FETCH
export const getUsersDirectories = async (req, res, next) => {
  try {
    const { userId, dirId } = req.params;
    const { cursor } = req.query;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    if (dirId && dirId !== "root" && !mongoose.isValidObjectId(dirId)) {
      return res.status(400).json({ error: "Invalid directory Id" });
    }

    if (cursor && !mongoose.isValidObjectId(cursor)) {
      return res.status(400).json({ error: "Invalid cursor" });
    }

    const parsedSort = sortSchema.safeParse(req.query.sort);

    const sort = parsedSort.success ? parsedSort.data : "date_desc";

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const findId = dirId === "root" || !dirId ? user.rootDirId : dirId;

    const directoryData = await Directory.findOne({
      _id: findId,
      userId: userId,
    }).lean();

    if (!directoryData) {
      return res.status(404).json({ error: "Directory Not Found" });
    }

    const query = {
      parentDirId: findId,
      userId: userId,
    };

    const { data, nextCursor, hasMore } = await handleCursorPagination({
      model: Directory,
      query,
      cursor,
      sort,
      limit: 20,
      sortMap: directorySortMap,
      cursorConfig: directoryCursorConfig,
    });

    const populatedData = await Directory.populate(data, {
      path: "path",
      select: "_id name",
      options: { lean: true },
    });

    return res.status(200).json({
      directories: populatedData,
      directoryData: directoryData,
      nextCursor,
      hasMore,
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};

//GET USERS FILES ACCORDING TO DIRECTORY
export const getUsersFiles = async (req, res, next) => {
  try {
    const { userId, dirId } = req.params;
    const { cursor } = req.query;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    if (dirId && dirId !== "root" && !mongoose.isValidObjectId(dirId)) {
      return res.status(400).json({ error: "Invalid directory Id" });
    }

    if (cursor && !mongoose.isValidObjectId(cursor)) {
      return res.status(400).json({ error: "Invalid cursor" });
    }

    const parsedSort = sortSchema.safeParse(req.query.sort);

    const sort = parsedSort.success ? parsedSort.data : "date_desc";

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const findId = dirId === "root" || !dirId ? user.rootDirId : dirId;

    const directoryData = await Directory.findOne({
      _id: findId,
      userId: userId,
    }).lean();

    if (!directoryData) {
      return res.status(404).json({ error: "Directory Not Found" });
    }

    const query = {
      parentDirId: findId,
      userId: userId,
      isTrashed: false,
    };

    const { data, nextCursor, hasMore } = await handleCursorPagination({
      model: File,
      query,
      cursor,
      sort,
      limit: 20,
      sortMap: fileSortMap,
      cursorConfig: fileCursorConfig,
    });

    return res.status(200).json({
      directoryData,
      files: data,
      nextCursor,
      hasMore,
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};

//USERS DIRECTORY RENAME
export const usersDirectoryRename = async (req, res) => {
  const { userId, dirId } = req.params;
  const { renameValue } = req.body;

  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  if (dirId && !mongoose.isValidObjectId(dirId)) {
    return res.status(400).json({ error: "Invalid directory Id" });
  }

  const { success, data, error } = dirAndFileNameSchema.safeParse(renameValue);

  if (!success) {
    return res.status(400).json({ error: error.issues[0].message });
  }

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  if (user.rootDirId.toString() === dirId) {
    return res.status(403).json({
      error: "Root directory cannot be renamed",
    });
  }

  const directory = await Directory.findOne({ _id: dirId, userId });
  if (!directory) {
    return res.status(400).json({ error: "Directory not found!" });
  }
  try {
    directory.name = data;
    await directory.save();
    return res.status(200).json({ message: "Folder Renamed Successfully" });
  } catch (error) {
    return res.status(500).json({ error: "Failed to rename directory" });
  }
};

// DIRECTORY DELETE (ADMIN / USER LEVEL)
export const usersDirectoryDelete = async (req, res, next) => {
  const { dirId, userId } = req.params;

  if (!mongoose.isValidObjectId(dirId)) {
    return res.status(400).json({ error: "Invalid directory id" });
  }

  const rootDir = await Directory.findOne({
    _id: dirId,
    userId,
  }).lean();

  if (!rootDir) {
    return res.status(404).json({ message: "Directory Not Found" });
  }

  if (!rootDir.parentDirId) {
    return res.status(400).json({
      error: "Root directory cannot be deleted",
    });
  }

  // FINDING CHILDRENS AND ADDING ROOTID INTO HAVETODELETEDIR
  const dirs = await Directory.find({
    userId,
    $or: [{ _id: rootDir._id }, { path: rootDir._id }],
  })
    .select("_id")
    .lean();

  const haveToDeleteDir = dirs.map((elem) => elem._id);

  const files = await File.find({
    parentDirId: { $in: haveToDeleteDir },
  })
    .select("_id extension fileType")
    .lean();

  const haveToDeleteFiles = files.map((elem) => elem._id);
  const haveToDeleteFilesFullNames = files.map(
    (elem) => `${elem._id.toString()}${elem.extension}`,
  );

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    if (
      rootDir.path &&
      rootDir.path.length > 0 &&
      (rootDir.directorySize > 0 || rootDir.fileCount > 0)
    ) {
      const incUpdate = {};

      if (rootDir.directorySize > 0) {
        incUpdate.directorySize = -rootDir.directorySize;
      }
      if (rootDir.fileCount > 0) {
        incUpdate.fileCount = -Math.floor(rootDir.fileCount);
      }
      if (Object.keys(incUpdate).length > 0) {
        //DIRECTORY SIZE DECREMENT
        await Directory.updateMany(
          {
            userId,
            _id: { $in: rootDir.path },
          },
          {
            $inc: incUpdate,
          },
          { session },
        );
      }
    }

    // FOLDERCOUNT DECREMENT (DIRECT PARENT ONLY)
    await Directory.findOneAndUpdate(
      {
        _id: rootDir.parentDirId,
        userId,
      },
      { $inc: { folderCount: -1 } },
      { session },
    );

    // DB CLEANING
    if (haveToDeleteFiles.length > 0) {
      await File.deleteMany({ _id: { $in: haveToDeleteFiles } }, { session });
    }

    if (haveToDeleteDir.length > 0) {
      await Directory.deleteMany(
        { _id: { $in: haveToDeleteDir } },
        { session },
      );
    }

    await session.commitTransaction();
    session.endSession();

    const imageFiles = files.filter((file) => file.fileType === "image" || file.fileType === "video");
    if (imageFiles.length > 0) {
      await Promise.all(
        imageFiles.map((file) =>
          deleteThumbnail(
            file._id.toString(),
            userId.toString(),
            file.extension,
          ),
        ),
      );
    }

    // FILESYSTEM CLEANUP (OUTSIDE TRANSACTION)
    if (haveToDeleteFilesFullNames.length > 0) {
      await permanentlyDeleteMultipleFromB2(haveToDeleteFilesFullNames);
    }

    //DELETING SHARE DATA IF AVAILABLE
    await Share.deleteMany({
      ownerId: userId,
      fileId: { $in: haveToDeleteFiles },
    });

    // CACHE INVALIDATION
    await redisClient.del(`profile:${userId}`);
    await redisClient.del(`insight:${userId}`);
    const keys = haveToDeleteDir.map((id) => `folderInsight:${userId}:${id}`);
    keys.push(`insight:${userId}`);
    await redisClient.del(keys);

    return res
      .status(200)
      .json({ message: "The folder and all its contents have been deleted." });
  } catch (error) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    next(error);
  }
};

//USERS FILE VIEW AND DOWNLOAD
export const usersFileViewAndDownload = async (req, res) => {
  const { userId, dirId, fileId } = req.params;
  const { action } = req.query;

  const allowedActions = ["open", "download"];

  if (action && !allowedActions.includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }

  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  if (dirId && dirId !== "root" && !mongoose.isValidObjectId(dirId)) {
    return res.status(400).json({ error: "Invalid directory Id" });
  }

  if (!mongoose.isValidObjectId(fileId)) {
    return res.status(400).json({ error: "Invalid fileId" });
  }

  let rootDirId = "";
  if (dirId === "root") {
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    rootDirId = user.rootDirId;
  } else {
    rootDirId = dirId;
  }

  //FILE FINDING WITH TRIPLE PARAMETERS FOR SECURITY
  const fileInfo = await File.findOne({
    _id: fileId,
    userId,
    parentDirId: rootDirId,
  }).select("_id extension name fileType");

  const s3Key = `${fileInfo._id}${fileInfo.extension}`;
  const encodedFileName = encodeURIComponent(fileInfo.name);

  let disposition;
  if (action === "open") {
    disposition = "inline";
  } else if (action === "download") {
    disposition = `attachment; filename="${encodedFileName}"`;
  }

  const command = new GetObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: s3Key,
    ResponseContentDisposition: disposition,
  });

  const signedUrl = await getSignedUrl(s3Client, command, {
    expiresIn: 60 * 2, // 2 minutes
  });

  return res.redirect(signedUrl);
};

//USERS FILE RENAME
export const usersFileRename = async (req, res) => {
  const { userId, dirId, fileId } = req.params;
  const { renameValue } = req.body;

  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  if (dirId && dirId !== "root" && !mongoose.isValidObjectId(dirId)) {
    return res.status(400).json({ error: "Invalid directory Id" });
  }

  if (!mongoose.isValidObjectId(fileId)) {
    return res.status(400).json({ error: "Invalid fileId" });
  }

  const { success, data, error } = dirAndFileNameSchema.safeParse(renameValue);

  if (!success) {
    return res.status(400).json({ error: error.issues[0].message });
  }

  let rootDirId = "";
  if (dirId === "root") {
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    rootDirId = user.rootDirId;
  } else {
    rootDirId = dirId;
  }

  //FILE FINDING WITH TRIPLE PARAMETERS FOR SECURITY
  const fileInfo = await File.findOne({
    _id: fileId,
    userId,
    parentDirId: rootDirId,
  }).select("name");

  if (!fileInfo) {
    return res.status(404).json({ error: "File not found or access denied" });
  }

  try {
    fileInfo.name = data;
    await fileInfo.save();

    return res.status(200).json({ message: "File Renamed Successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to rename file" });
  }
};

// USERS FILE DELETE
export const usersFileDelete = async (req, res, next) => {
  const { userId, dirId, fileId } = req.params;

  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: "Invalid userId" });
  }

  if (dirId && dirId !== "root" && !mongoose.isValidObjectId(dirId)) {
    return res.status(400).json({ error: "Invalid directory Id" });
  }

  if (!mongoose.isValidObjectId(fileId)) {
    return res.status(400).json({ error: "Invalid fileId" });
  }

  let rootDirId = "";
  if (dirId === "root") {
    const user = await User.findById(userId).lean();

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    rootDirId = user.rootDirId;
  } else {
    rootDirId = dirId;
  }

  try {
    // FILE FINDING WITH TRIPLE PARAMETERS FOR SECURITY
    const fileInfo = await File.findOne({
      _id: fileId,
      userId,
      parentDirId: rootDirId,
    });

    if (!fileInfo) {
      return res.status(404).json({ error: "File not found or access denied" });
    }

    const parentDir = await Directory.findById(fileInfo.parentDirId)
      .select("path")
      .lean();

    if (!parentDir) {
      return res.status(404).json({ message: "Parent directory not found" });
    }

    const deleteArr = [];
    const encodedFileName = `${fileInfo._id}${fileInfo.extension}`;
    deleteArr.push(encodedFileName);

    try {
      if (fileInfo.fileType === "image" || fileInfo.fileType === "video") {
        await deleteThumbnail(
          fileInfo._id.toString(),
          userId.toString(),
          fileInfo.extension,
        );
      }
      await permanentlyDeleteMultipleFromB2(encodedFileName);
    } catch (error) {
      return res.status(500).json({ error: "Failed to delete file" });
    }

    // DIRECTORY SIZE DECREASE AND FILECOUNT DECREASE RECURSIVLY
    const affectedDirIds = [...parentDir.path, parentDir._id];

    await Directory.updateMany(
      {
        userId,
        _id: { $in: affectedDirIds },
      },
      {
        $inc: {
          directorySize: -fileInfo.fileSize,
          fileCount: -1,
        },
      },
    );

    await fileInfo.deleteOne();

    //DELETING SHARE DATA IF AVAILABLE
    await Share.deleteMany({
      ownerId: userId,
      fileId: fileInfo._id,
    });

    // CACHE INVALIDATION
    await redisClient.del(`profile:${userId}`);
    await redisClient.del(`insight:${userId}`);
    const keys = affectedDirIds.map((id) => `folderInsight:${userId}:${id}`);
    keys.push(`insight:${userId}`);
    await redisClient.del(keys);

    res.status(200).json({ message: "File Deleted Successfully" });
  } catch (error) {
    console.log(error);
    next(error);
  }
};
