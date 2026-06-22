import path from "node:path";
import File from "../Models/fileModel.js";
import mongoose from "mongoose";
import {
  createPutSignedUrlSchema,
  dirAndFileNameSchema,
} from "../validators/authSchema.js";
import Directory from "../Models/directoryModel.js";
import { redisClient } from "../config/redis.js";
import User from "../Models/userModel.js";
import {
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  permanentlyDeleteMultipleFromB2,
  s3Client,
} from "../config/s3Client.js";
import Share from "../Models/shareModel.js";
import { NOTIFICATION_TYPES } from "../config/notificationTypes.js";
import { createNotification } from "../services/notificationService.js";
import { PLANS } from "../config/plans.js";
import { handleCursorPagination } from "../utils/pagination.js";
import { fileSortMap } from "../utils/sortMap.js";
import { fileCursorConfig } from "../utils/cursorConfig.js";
import mime from "mime-types";
import { getFileCategory } from "../utils/extensionMaps.js";
import {
  generateThumbnail,
  deleteThumbnail,
} from "../services/thumbnailService.js";
import { thumbnailClient } from "../config/thumbnailClient.js";

//WATCH AND DOWNLOAD
export const WatchAndDownload = async (req, res) => {
  const { id } = req.params;
  const { action } = req.query;

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: "Invalid fileId" });
  }

  const fileInfo = await File.findOne({
    _id: id,
    userId: req.user._id,
  }).lean();

  if (!fileInfo) {
    return res.status(404).json({ message: "File Not Found" });
  }

  const user = await User.findById(req.user._id).select(
    "planId bandwidthUsedBytes bandwidthCycleStart",
  );

  if (!user) {
    return res.status(404).json({ error: "Failed to fetch user plan" });
  }

  const now = Date.now();

  if (user.planId === "spark_free") {
    const cycleStart = user.bandwidthCycleStart?.getTime() || now;

    const nextReset = cycleStart + 1000 * 60 * 60 * 24 * 30;
    if (now > nextReset) {
      await User.updateOne(
        { _id: req.user._id },
        { bandwidthUsedBytes: 0, bandwidthCycleStart: new Date() },
      );
    }
  }

  const plan = PLANS.find((elem) => elem.planId === user.planId);

  const updatedUser = await User.findOneAndUpdate(
    {
      _id: user._id,
      bandwidthUsedBytes: {
        $lte: plan.bandwidthMonthlyBytes - fileInfo.fileSize,
      },
    },
    { $inc: { bandwidthUsedBytes: fileInfo.fileSize } },
    { new: true },
  );

  if (!updatedUser) {
    return res.status(403).json({ error: "Monthly bandwidth limit exceeded" });
  }

  const s3Key = `${id}${fileInfo.extension}`;
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

  const lastAccess = fileInfo.lastAccessedAt?.getTime?.() || 0;

  if (lastAccess < Date.now() - 10 * 60 * 1000) {
    await File.findOneAndUpdate({_id: id}, { lastAccessedAt: new Date() });
  }

  const payload = { id: fileInfo._id, name: fileInfo.name, url: signedUrl };
  return res.status(200).json(payload);
};

//RENAME
export const FileRename = async (req, res) => {
  const { renameValue } = req.body;
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: "Invalid fileId" });
  }

  const { success, data, error } = dirAndFileNameSchema.safeParse(renameValue);

  if (!success) {
    return res.status(400).json({ error: error.issues[0].message });
  }

  let fileInfo;
  try {
    fileInfo = await File.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!fileInfo) {
      return res.status(404).json({ error: "File Not Found" });
    }

    fileInfo.name = data;
    await fileInfo.save();

    return res.status(200).json({ message: "File Renamed Successfully" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Undefined rename value" });
  }
};

//CREATE AWS S3 UPLOAD SIGNED URL
export const createPutSignedUrl = async (req, res) => {
  const parentDirId = req.body.parentDirId || req.user.rootDirId;
  const files = req.body.files;

  if (!mongoose.isValidObjectId(parentDirId)) {
    return res.status(400).json({ error: "Invalid directory id" });
  }

  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: "Files array is required" });
  }

  const user = await User.findById(req.user._id).lean().select("planId");

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const plan = PLANS.find((elem) => elem.planId === user.planId);

  if (!plan) {
    return res.status(400).json({ error: "Invalid subscription plan" });
  }

  const schema = createPutSignedUrlSchema(plan.maxFileSizeBytes);
  let batchSizeinBytes = 0;

  const validatedFiles = [];

  for (const file of files) {
    const parsed = schema.safeParse(file);

    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0].message,
      });
    }

    const { size } = parsed.data;
    batchSizeinBytes += size;
    validatedFiles.push(parsed.data);
  }

  //STORAGE CHECK
  const rootDir = await Directory.findById(req.user.rootDirId)
    .lean()
    .select("directorySize");

  if (!rootDir) {
    return res.status(400).json({ error: "Root directory not found" });
  }

  const storageUsed = rootDir.directorySize;

  if (storageUsed == null || plan.storageBytes == null) {
    return res
      .status(400)
      .json({ error: "Can't fetch storage used or max storage limit" });
  }

  const storageAvailable = plan.storageBytes - storageUsed;

  if (storageAvailable < batchSizeinBytes) {
    return res.status(507).json({ error: "Insufficient storage" });
  }

  if (batchSizeinBytes > plan.maxBatchUploadBytes) {
    return res.status(413).json({
      error: "Batch upload limit exceeded",
    });
  }

  if (files.length > plan.maxFilesPerBatch) {
    return res.status(413).json({
      error: "Too many files in single upload",
    });
  }

  //CREATING SIGNED URLS
  const parentDir = await Directory.findOne({
    _id: parentDirId,
    userId: req.user._id,
  });

  if (!parentDir) {
    return res.status(404).json({ message: "Parent directory not found" });
  }

  try {
    const urls = await Promise.all(
      validatedFiles.map(async (file) => {
        const extension = path.extname(file.name);
        const fileMime = mime.lookup(extension.replace(".", "").toLowerCase());

        if (!extension) {
          throw new Error("File has no extension");
        }

        if (!fileMime) {
          throw new Error("Unsupported file type");
        }

        const type = getFileCategory(extension.replace(".", "").toLowerCase());

        let insertedFile;
        try {
          insertedFile = await File.create({
            extension,
            name: file.name,
            parentDirId,
            userId: req.user._id,
            fileSize: file.size,
            isUploading: true,
            mimeType: fileMime,
            fileType: type,
          });
        } catch (error) {
          console.log(error);
          throw new Error("Database error");
        }

        const insertedFileId = insertedFile._id;
        const encodedFileName = `${insertedFileId}${extension}`;
        let thumbnailSignedUrl = null;
        let thumbnailKey = null;

        const command = new PutObjectCommand({
          Bucket: process.env.BUCKET_NAME,
          Key: encodedFileName,
          ContentType: fileMime,
        });

        const url = await getSignedUrl(s3Client, command, {
          expiresIn: 300, // 5 minutes
        });

        if (file.hasThumbnail || type === "video") {
          thumbnailKey = `thumbnails/${req.user._id}/${encodedFileName}`;

          const thumbCommand = new PutObjectCommand({
            Bucket: process.env.S3_THUMBNAIL_BUCKET,
            Key: thumbnailKey,
            ContentType: "image/jpeg",
          });

          thumbnailSignedUrl = await getSignedUrl(
            thumbnailClient,
            thumbCommand,
            {
              expiresIn: 300,
            },
          );
        }

        return {
          signedUrl: url,
          fileId: insertedFileId,
          thumbnailSignedUrl,
          thumbnailKey: encodedFileName,
        };
      }),
    );

    return res.status(200).json(urls);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to generate signed URLs" });
  }
};

// FINALIZE AWS S3 FILE UPLOAD
export const finalizeFileUpload = async (req, res, next) => {
  const { fileId } = req.body;

  if (!mongoose.isValidObjectId(fileId)) {
    return res.status(400).json({ error: "Invalid file Id" });
  }

  const user = await User.findById(req.user._id).lean().select("planId");

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const plan = PLANS.find((elem) => elem.planId === user.planId);

  if (!plan) {
    return res.status(400).json({ error: "Invalid subscription plan" });
  }

  let fileInfo;
  let uploadSucceeded = false;

  try {
    fileInfo = await File.findOne({
      _id: fileId,
      userId: req.user._id,
      isUploading: true,
    });

    if (!fileInfo) {
      return res.status(400).json({ error: "File not found" });
    }

    const deleteArr = [];
    const encodedFileName = `${fileInfo._id}${fileInfo.extension}`;
    deleteArr.push(encodedFileName);

    const headCommand = new HeadObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: encodedFileName,
    });

    const s3Data = await s3Client.send(headCommand);

    if (s3Data.ContentLength !== fileInfo.fileSize) {
      await permanentlyDeleteMultipleFromB2(deleteArr);
      await File.findByIdAndDelete(fileInfo._id);

      throw new Error("File size mismatch");
    }

    const finalized = await File.findOneAndUpdate(
      { _id: fileInfo._id, isUploading: true },
      { $set: { isUploading: false } },
    );

    if (!finalized) {
      return res.status(409).json({ error: "Upload already finalized" });
    }

    // THUMBNAIL CHECK
    if (fileInfo.fileType === "video") {
      const thumbnailKey = `thumbnails/${req.user._id}/${encodedFileName}`;
      const cdnUrl = `https://cdn.sastadrive.in/thumbnails/${req.user._id}/${encodedFileName}`;

      const thumbHeadCommand = new HeadObjectCommand({
        Bucket: process.env.S3_THUMBNAIL_BUCKET,
        Key: thumbnailKey,
      });

      let thumbnailExists = false;

      try {
        const thumbData = await thumbnailClient.send(thumbHeadCommand);

        if (
          thumbData.ContentLength > 0 &&
          thumbData.ContentType === "image/jpeg"
        ) {
          thumbnailExists = true;
        }
      } catch (error) {
        thumbnailExists = false;
      }

      if (thumbnailExists) {
        await File.findOneAndUpdate(
          { _id: fileInfo._id },
          { $set: { thumbnailUrl: cdnUrl, thumbnailStatus: "done" } },
        );
      } else {
        await File.findOneAndUpdate(
          { _id: fileInfo._id },
          { $set: { thumbnailStatus: "pending" } },
        );
      }
    }

    const parentDir = await Directory.findById(fileInfo.parentDirId);

    if (!parentDir) {
      await permanentlyDeleteMultipleFromB2(deleteArr);
      await File.findByIdAndDelete(fileInfo._id);
      throw new Error("Parent directory not found");
    }

    const affectedDirIds = [...parentDir.path, parentDir._id];

    await Directory.updateMany(
      {
        userId: req.user._id,
        _id: { $in: affectedDirIds },
      },
      {
        $inc: {
          directorySize: fileInfo.fileSize,
          fileCount: 1,
        },
      },
    );

    await redisClient.del(`profile:${req.user._id}`);
    await redisClient.del(`insight:${req.user._id}`);

    const keys = affectedDirIds.map(
      (id) => `folderInsight:${req.user._id}:${id}`,
    );
    keys.push(`insight:${req.user._id}`);
    await redisClient.del(keys);

    const storageUsed = parentDir.directorySize;
    const storageUsedPercent = (
      (100 / plan.storageBytes) *
      storageUsed
    ).toFixed();

    if (storageUsedPercent >= 80 && storageUsedPercent < 90) {
      await createNotification({
        userId: req.user._id,
        type: NOTIFICATION_TYPES.STORAGE_80_PERCENT,
        title: "Storage 80% Used",
        message:
          "You have used 80% of your storage. Consider upgrading your plan to avoid reaching the limit.",
        metadata: {
          usedPercentage: 80,
        },
        group: true,
      });
    } else if (storageUsedPercent >= 90 && storageUsedPercent < 100) {
      await createNotification({
        userId: req.user._id,
        type: NOTIFICATION_TYPES.STORAGE_90_PERCENT,
        title: "Storage 90% Used",
        message:
          "Your storage is almost full (90% used). Upgrade your plan or delete unused files.",
        metadata: {
          usedPercentage: 90,
        },
        group: true,
      });
    } else if (storageUsedPercent >= 100) {
      await createNotification({
        userId: req.user._id,
        type: NOTIFICATION_TYPES.STORAGE_FULL,
        title: "Storage Full",
        message:
          "Your storage is full. Please upgrade your plan or remove files to continue uploading.",
        metadata: {
          usedPercentage: 100,
        },
        group: true,
      });
    }

    await createNotification({
      userId: req.user._id,
      type: NOTIFICATION_TYPES.FILE_UPLOAD_SUCCESS,
      title: "Files uploaded",
      message: "File uploaded",
      metadata: { folderId: fileInfo.parentDirId },
      group: true,
    });

    uploadSucceeded = true;

    if (fileInfo.fileType === "image" && !fileInfo.thumbnailUrl) {
      await generateThumbnail(fileId, req.user._id);
    }

    return res.status(200).json("Upload Completed");
  } catch (error) {
    if (!uploadSucceeded && fileInfo) {
      await createNotification({
        userId: req.user._id,
        type: NOTIFICATION_TYPES.FILE_UPLOAD_FAILED,
        title: "Upload failed",
        message: "File upload failed",
        metadata: { folderId: fileInfo.parentDirId },
        group: true,
      });
    }

    return next(error);
  }
};

//CANCEL AWS S3 FILE UPLOAD
export const cancelUpload = async (req, res) => {
  const { fileId } = req.body;

  if (!mongoose.isValidObjectId(fileId)) {
    return res.status(400).json({ error: "Invalid file Id" });
  }

  const deleted = await File.findOneAndDelete({
    _id: fileId,
    userId: req.user._id,
    isUploading: true,
  });

  if (!deleted) {
    return res
      .status(500)
      .json({ error: "Upload data not found or already finalized" });
  }

  return res.status(200).json({ message: "Upload canceled successfully" });
};

//FAVORITE
export const toggleFavorite = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: "Invalid file Id" });
  }
  try {
    const file = await File.findOneAndUpdate(
      { _id: id, userId: req.user._id },
      [{ $set: { favorite: { $not: "$favorite" } } }],
      { new: true },
    )
      .select("favorite -_id")
      .lean();

    if (!file) {
      return res.status(404).json({ error: "File not found" });
    }

    return res.status(200).json({
      message: file.favorite ? "Added to favorites" : "Removed from favorites",
      favorite: file.favorite,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to toggle favorite" });
  }
};

//BULK REMOVE FROM FAVORITES
export const bulkRemoveFromFav = async (req, res) => {
  const { fileIds } = req.body;

  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return res.status(400).json({ error: "fileIds must be a non-empty array" });
  }

  for (const id of fileIds) {
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid fileId" });
    }
  }
  try {
    const result = await File.updateMany(
      { _id: { $in: fileIds }, userId: req.user._id, favorite: true },
      { $set: { favorite: false } },
    );

    return res.status(200).json({
      message: "Items removed from favorites",
      removed: result.modifiedCount,
    });
  } catch (error) {
    console.error("Bulk remove from favorites failed", error);
    return res.status(500).json({ error: "Failed to remove from favorites" });
  }
};

//GET ALL FAVORITES
export const getAllFavorites = async (req, res) => {
  try {
    const { cursor, sort, type } = req.query;

    const allowedTypes = ["image", "video", "audio", "document", "other"];

    if (type && !allowedTypes.includes(type)) {
      return res.status(400).json({ error: "Invalid file type" });
    }

    const query = {
      userId: req.user._id,
      favorite: true,
      isTrashed: false,
    };

    if (type) {
      query.fileType = type;
    }

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
      favorites: data,
      nextCursor,
      hasMore,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch favorite data" });
  }
};

//GET ALL FILES
export const getAllFiles = async (req, res) => {
  try {
    const { cursor, sort, type } = req.query;

    const allowedTypes = ["image", "video", "audio", "document", "other"];

    if (type && !allowedTypes.includes(type)) {
      return res.status(400).json({ error: "Invalid file type" });
    }

    const query = {
      userId: req.user._id,
      isUploading: false,
      isTrashed: false,
    };

    if (type) {
      query.fileType = type;
    }

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
      files: data,
      nextCursor,
      hasMore,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch user files" });
  }
};

//MOVE TO TRASH
export const moveToTrash = async (req, res) => {
  const { fileIds } = req.body;

  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return res.status(400).json({ error: "fileIds must be a non-empty array" });
  }

  for (const id of fileIds) {
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid fileId" });
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  let transactionCommited = false;

  try {
    const fileInfos = await File.find({
      _id: { $in: fileIds },
      userId: req.user._id,
      isTrashed: false,
    })
      .select("name extension parentDirId fileSize")
      .populate("parentDirId")
      .session(session);

    if (fileInfos.length === 0) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Files Not Found" });
    }

    const idsToTrash = fileInfos.map((e) => e._id);

    const userInfo = await User.findById(req.user._id).select("planId");

    if (!userInfo) {
      return res.status(500).json({ error: "Failed to get user details" });
    }

    const plan = PLANS.find((elem) => elem.planId === userInfo.planId);

    if (!plan) {
      return res.status(400).json({ error: "Invalid subscription plan" });
    }

    const now = new Date();
    const deleteAfterDays = plan.trashRecoveryDays;

    await File.updateMany(
      { _id: { $in: idsToTrash }, isTrashed: false, userId: req.user._id },
      {
        $set: {
          isTrashed: true,
          trashedAt: now,
          deletedAt: new Date(
            now.getTime() + deleteAfterDays * 24 * 60 * 60 * 1000,
          ),
        },
      },
      { session },
    );

    let affectedDirIds;
    for (const file of fileInfos) {
      if (!file.parentDirId) continue;
      affectedDirIds = [...file.parentDirId.path, file.parentDirId._id];
      const fileSize = file.fileSize;

      await Directory.updateMany(
        {
          userId: req.user._id,
          _id: { $in: affectedDirIds },
        },
        {
          $inc: {
            directorySize: -fileSize,
            fileCount: -1,
          },
        },
        { session },
      );
    }

    //DELETING SHARE DATA IF AVAILABLE
    await Share.deleteMany(
      {
        ownerId: req.user._id,
        fileId: { $in: idsToTrash },
      },
      { session },
    );

    await session.commitTransaction();
    transactionCommited = true;
    session.endSession();

    //CACHE INVALIDATION
    await redisClient.del(`profile:${req.user._id}`);
    await redisClient.del(`insight:${req.user._id}`);
    const keys = affectedDirIds.map(
      (id) => `folderInsight:${req.user._id}:${id}`,
    );
    keys.push(`insight:${req.user._id}`);
    await redisClient.del(keys);

    await createNotification({
      userId: req.user._id,
      type: NOTIFICATION_TYPES.FILE_DELETED,
      title: "Files deleted",
      message: "File moved to trash",
      metadata: { folderId: req.user.rootDirId },
      group: true,
      incrementBy: fileInfos.length,
    });

    return res.status(200).json({
      message: "Files moved to trash successfully",
      trashed: fileInfos.length,
    });
  } catch (error) {
    if (!transactionCommited) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("Files moving to trash unsuccessful", error);
    return res.status(500).json({ error: "Failed to move files to trash" });
  }
};

//RESTORE FROM TRASH
export const restoreFromTrash = async (req, res) => {
  const { fileIds } = req.body;

  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return res.status(400).json({ error: "fileIds must be a non-empty array" });
  }

  for (const id of fileIds) {
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid fileId" });
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  let transactionCommited = false;

  try {
    const fileInfos = await File.find({
      _id: { $in: fileIds },
      userId: req.user._id,
      isTrashed: true,
    })
      .select("name extension parentDirId fileSize")
      .populate("parentDirId")
      .session(session);

    if (fileInfos.length === 0) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Files Not Found in trash" });
    }

    const idsToRestore = fileInfos.map((e) => e._id);

    await File.updateMany(
      { _id: { $in: idsToRestore }, isTrashed: true, userId: req.user._id },
      {
        $set: {
          isTrashed: false,
          trashedAt: null,
          deletedAt: null,
        },
      },
      { session },
    );

    let affectedDirIds;
    for (const file of fileInfos) {
      if (!file.parentDirId) continue;
      affectedDirIds = [...file.parentDirId.path, file.parentDirId._id];
      const fileSize = file.fileSize;

      await Directory.updateMany(
        {
          userId: req.user._id,
          _id: { $in: affectedDirIds },
        },
        {
          $inc: {
            directorySize: +fileSize,
            fileCount: +1,
          },
        },
        { session },
      );
    }

    await session.commitTransaction();
    transactionCommited = true;
    session.endSession();

    //CACHE INVALIDATION
    await redisClient.del(`profile:${req.user._id}`);
    await redisClient.del(`insight:${req.user._id}`);
    const keys = affectedDirIds.map(
      (id) => `folderInsight:${req.user._id}:${id}`,
    );
    keys.push(`insight:${req.user._id}`);
    await redisClient.del(keys);

    return res.status(200).json({
      message: "Files restored successfully",
      restored: fileInfos.length,
    });
  } catch (error) {
    if (!transactionCommited) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("File restoration unsuccessful", error);
    return res.status(500).json({ error: "Failed to restore files" });
  }
};

//GET ALL TRASH FILES
export const getAllTrash = async (req, res) => {
  try {
    const { cursor, sort, type } = req.query;

    const allowedTypes = ["image", "video", "audio", "document", "other"];

    if (type && !allowedTypes.includes(type)) {
      return res.status(400).json({ error: "Invalid file type" });
    }

    const query = {
      userId: req.user._id,
      isUploading: false,
      isTrashed: true,
    };

    if (type) {
      query.fileType = type;
    }

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
      items: data,
      nextCursor,
      hasMore,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch trash" });
  }
};

//DELETE
export const multipleDelete = async (req, res) => {
  const { fileIds } = req.body;

  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return res.status(400).json({ error: "fileIds must be a non-empty array" });
  }

  for (const id of fileIds) {
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid fileId" });
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const fileInfos = await File.find({
      _id: { $in: fileIds },
      userId: req.user._id,
    })
      .select("name extension parentDirId fileSize fileType")
      .populate("parentDirId")
      .session(session);

    if (fileInfos.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ error: "File Not Found" });
    }

    const objects = fileInfos.map((file) => `${file._id}${file.extension}`);

    const results = await Promise.all(
      fileInfos.map(async (file) => {
        const affectedDirIds = [...file.parentDirId.path, file.parentDirId._id];

        const fileSize = file.fileSize;
        await Directory.updateMany(
          {
            userId: req.user._id,
            _id: { $in: affectedDirIds },
          },
          {
            $inc: {
              directorySize: -fileSize,
              fileCount: -1,
            },
          },
          { session },
        );

        await file.deleteOne({ session });
        return affectedDirIds.map((id) => id.toString());
      }),
    );

    const allAffectedDirIds = new Set(results.flat());

    //DELETING SHARE DATA IF AVAILABLE
    await Share.deleteMany(
      {
        ownerId: req.user._id,
        fileId: { $in: fileIds },
      },
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    await Promise.all(
      fileInfos
        .filter(
          (file) => file.fileType === "image" || file.fileType === "video",
        )
        .map((file) =>
          deleteThumbnail(
            file._id.toString(),
            req.user._id.toString(),
            file.extension,
          ),
        ),
    );

    try {
      await permanentlyDeleteMultipleFromB2(objects);
    } catch (error) {
      console.log("file deletion failed", error);
    }

    const finalAffectedDirIds = Array.from(allAffectedDirIds);

    //CACHE INVALIDATION
    await redisClient.del(`profile:${req.user._id}`);

    const keys = finalAffectedDirIds.map(
      (id) => `folderInsight:${req.user._id}:${id}`,
    );
    keys.push(`insight:${req.user._id}`);
    await redisClient.del(...keys);

    await createNotification({
      userId: req.user._id,
      type: NOTIFICATION_TYPES.FILE_PERMANENTLY_DELETED,
      title: "Files permanently deleted",
      message: "Files permanently deleted",
      metadata: { folderId: req.user.rootDirId },
      group: false,
      incrementBy: fileIds.length,
    });

    return res.status(200).json({
      message: "Files permanently deleted",
      deleted: fileIds.length,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("Permanent delete failed", error);
    return res.status(500).json({ error: "Failed to delete files" });
  }
};

//FILE MOVE
export const fileMove = async (req, res) => {
  const { fileIds, targetDirId } = req.body;

  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return res.status(400).json({ error: "fileIds must be a non-empty array" });
  }

  for (const id of fileIds) {
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid fileId" });
    }
  }

  if (!mongoose.isValidObjectId(targetDirId)) {
    return res.status(400).json({ error: "Invalid destination file id" });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const fileInfos = await File.find({
      _id: { $in: fileIds },
      userId: req.user._id,
      isTrashed: false,
    })
      .select("parentDirId fileSize")
      .populate("parentDirId")
      .session(session);

    if (fileInfos.length === 0) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Files Not Found" });
    }

    const targetDirInfo = await Directory.findOne({
      _id: targetDirId,
      userId: req.user._id,
    }).session(session);

    if (!targetDirInfo) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Target folder not found" });
    }

    const alreadyInTarget = fileInfos.every(
      (file) => file.parentDirId?._id.toString() === targetDirId,
    );

    if (alreadyInTarget) {
      await session.abortTransaction();
      return res.status(400).json({
        error: "Files are already in the selected folder",
      });
    }

    const idsToMove = fileInfos.map((e) => e._id);
    const sizeArr = fileInfos.map((e) => e.fileSize);
    const totalSize = sizeArr.reduce((acc, crr) => acc + crr, 0);

    const parentMap = {};
    for (const { fileSize, parentDirId } of fileInfos) {
      if (!parentDirId) continue;

      const parentId = parentDirId._id.toString();
      if (parentId === targetDirId) continue;

      parentMap[parentId] ??= {
        totalSize: 0,
        fileCount: 0,
        affectedDirIds: [...parentDirId.path, parentDirId._id],
      };

      parentMap[parentId].totalSize += fileSize;
      parentMap[parentId].fileCount += 1;
    }

    await File.updateMany(
      { _id: { $in: idsToMove }, isTrashed: false, userId: req.user._id },
      {
        $set: {
          parentDirId: targetDirId,
        },
      },
      { session },
    );

    for (const entry of Object.values(parentMap)) {
      await Directory.updateMany(
        {
          userId: req.user._id,
          _id: { $in: entry.affectedDirIds },
        },
        {
          $inc: {
            directorySize: -entry.totalSize,
            fileCount: -entry.fileCount,
          },
        },
        { session },
      );
    }

    const targetAffectedDirIds = [...targetDirInfo.path, targetDirInfo._id];

    await Directory.updateMany(
      {
        userId: req.user._id,
        _id: { $in: targetAffectedDirIds },
      },
      {
        $inc: {
          directorySize: totalSize,
          fileCount: fileInfos.length,
        },
      },
      { session },
    );

    await redisClient.del(`profile:${req.user._id}`);
    await redisClient.del(`insight:${req.user._id}`);

    const keys = targetAffectedDirIds.map(
      (id) => `folderInsight:${req.user._id}:${id}`,
    );
    keys.push(`insight:${req.user._id}`);
    await redisClient.del(keys);

    await session.commitTransaction();
    session.endSession();

    await createNotification({
      userId: req.user._id,
      type: NOTIFICATION_TYPES.FILE_MOVED,
      title: "Files moved",
      message: `${fileInfos.length} file(s) moved successfully`,
      metadata: { folderId: targetDirId },
      group: true,
      incrementBy: fileInfos.length,
    });

    return res.status(200).json({
      message: "Files moved successfully",
      moved: fileInfos.length,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("Files moving unsuccessful", error);
    return res.status(500).json({ error: "Failed to move files" });
  }
};

//GET RECENT FILES
export const getRecentFiles = async (req, res) => {
  try {
    const fileInfos = await File.find({
      userId: req.user._id,
    })
      .sort({ lastAccessedAt: -1, updatedAt: -1, createdAt: -1 })
      .limit(15)
      .select("name extension fileType fileSize lastAccessedAt favorite updatedAt createdAt thumbnailUrl");

    return res.status(200).json(fileInfos);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: "Failed to get recent files" });
  }
};
