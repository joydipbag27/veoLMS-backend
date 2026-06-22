import mongoose from "mongoose";
import Directory from "../Models/directoryModel.js";
import File from "../Models/fileModel.js";
import User from "../Models/userModel.js";
import { PLANS } from "../config/plans.js";
import { redisClient } from "../config/redis.js";
import { MB } from "../utils/bytes.js";
import { LargeOldFilesQuerySchema } from "../validators/authSchema.js";
import Share from "../Models/shareModel.js";

export const getStorageInsights = async (req, res) => {
  try {
    const redisKey = `insight:${req.user._id}`;

    try {
      const cached = await redisClient.json.get(redisKey);
      if (cached) return res.status(200).json(cached);
    } catch (redisErr) {
      console.error("Redis read error:", redisErr);
    }

    const [userInfo, rootDirInfo] = await Promise.all([
      User.findById(req.user._id),
      Directory.findById(req.user.rootDirId),
    ]);

    if (!userInfo || !rootDirInfo) {
      return res.status(404).json({ error: "User data not found" });
    }

    const plan = PLANS.find((p) => p.planId === userInfo.planId);
    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    const fileInfos = await File.find({
      userId: req.user._id,
    }).select("extension fileSize fileType");

    const totalStorage = plan.storageBytes;
    const usedStorage = rootDirInfo.directorySize;
    const freeStorage = Math.max(0, totalStorage - usedStorage);
    const usedPercentage = totalStorage
      ? +((usedStorage / totalStorage) * 100).toFixed(2)
      : 0;

    let warningLevel =
      usedPercentage >= 90
        ? "critical"
        : usedPercentage >= 80
          ? "warning"
          : "safe";

    let imageBytes = 0,
      videoBytes = 0,
      audioBytes = 0,
      documentBytes = 0,
      otherBytes = 0;

    fileInfos.forEach((file) => {
      const type = file.fileType;

      if (type === "image") imageBytes += file.fileSize;
      else if (type === "video") videoBytes += file.fileSize;
      else if (type === "audio") audioBytes += file.fileSize;
      else if (type === "document") documentBytes += file.fileSize;
      else otherBytes += file.fileSize;
    });

    const payload = {
      storage: {
        totalBytes: totalStorage,
        usedBytes: usedStorage,
        freeBytes: freeStorage,
        usedPercentage,
        fileCount: rootDirInfo.fileCount,
        folderCount: rootDirInfo.folderCount,
      },
      alert: { level: warningLevel },
      distribution: {
        image: imageBytes,
        video: videoBytes,
        audio: audioBytes,
        document: documentBytes,
        other: otherBytes,
      },
    };

    try {
      await redisClient
        .multi()
        .json.set(redisKey, "$", payload)
        .expire(redisKey, 900)
        .exec();
    } catch (redisErr) {
      console.error("Redis write error:", redisErr);
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error("getStorageInsights error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getFolderInsights = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid directory id" });
    }

    const redisKey = `folderInsight:${req.user._id}:${id}`;

    try {
      const cached = await redisClient.json.get(redisKey);
      if (cached) return res.status(200).json(cached);
    } catch (err) {
      console.error("Redis read error:", err);
    }

    const rootDirInfo = await Directory.findOne({
      userId: req.user._id,
      _id: id,
    });

    if (!rootDirInfo) {
      return res.status(404).json({ error: "Folder not found" });
    }

    const dirs = await Directory.find({
      path: id,
      userId: req.user._id,
    }).select("_id");

    const nestedDirs = [rootDirInfo._id, ...dirs.map((d) => d._id)];

    const uploadActivity = await File.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(req.user._id),
          parentDirId: { $in: nestedDirs },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          count: { $sum: 1 },
          totalBytes: { $sum: "$fileSize" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const totalUploads = uploadActivity.reduce((sum, d) => sum + d.count, 0);

    const duplicates = await File.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(req.user._id),
          parentDirId: { $in: nestedDirs },
        },
      },
      {
        $group: {
          _id: {
            name: "$name",
            size: "$fileSize",
          },
          files: {
            $push: {
              _id: "$_id",
              parentDirId: "$parentDirId",
            },
          },
          count: { $sum: 1 },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
        },
      },
    ]);

    const totalDuplicateGroups = duplicates.length;
    const totalDuplicateFiles = duplicates.reduce((sum, d) => sum + d.count, 0);
    const wastedBytes = duplicates.reduce(
      (sum, d) => sum + (d.count - 1) * d._id.size,
      0,
    );

    const filesTable = await File.find({
      userId: req.user._id,
      parentDirId: { $in: nestedDirs },
    })
      .sort({ fileSize: -1 })
      .limit(50)
      .select("_id name extension fileSize")
      .lean();

    const formattedLargestFiles = filesTable.slice(0, 5);

    const formattedFilesTable = filesTable.map((file) => ({
      id: file._id,
      name: file.name,
      sizeBytes: file.fileSize,
      type: file.fileType,
    }));

    const payload = {
      folder: {
        id: rootDirInfo._id,
        name: rootDirInfo.name,
        fileCount: rootDirInfo.fileCount,
        folderCount: dirs.length,
      },
      storage: {
        usedBytes: rootDirInfo.directorySize,
      },
      activity: {
        uploadFrequency: uploadActivity,
        totalUploads,
        firstUploadDate: uploadActivity[0]?._id || null,
        lastUploadDate: uploadActivity[uploadActivity.length - 1]?._id || null,
      },
      breakdown: {
        largestFiles: formattedLargestFiles,
        filesTable: formattedFilesTable,
        summary: {
          averageFileSize: rootDirInfo.fileCount
            ? (rootDirInfo.directorySize / rootDirInfo.fileCount).toFixed()
            : 0,
          largestFileSize: formattedLargestFiles[0]?.fileSize || 0,
        },
        duplicates: {
          totalDuplicateFiles,
          totalDuplicateGroups,
          wastedBytes,
        },
      },
    };

    try {
      await redisClient
        .multi()
        .json.set(redisKey, "$", payload)
        .expire(redisKey, 600)
        .exec();
    } catch (err) {
      console.error("Redis write error:", err);
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error("getFolderInsights error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getDuplicateInsights = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid folder id" });
    }

    const rootDir = await Directory.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!rootDir) {
      return res.status(404).json({ error: "Folder not found" });
    }

    // 🔹 Get recursive folder scope
    const subDirs = await Directory.find({
      path: id,
      userId: req.user._id,
    }).select("_id");

    const nestedDirs = [rootDir._id, ...subDirs.map((d) => d._id)];

    const duplicates = await File.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(req.user._id),
          parentDirId: { $in: nestedDirs },
        },
      },
      {
        $group: {
          _id: {
            name: "$name",
            size: "$fileSize",
          },
          fileIds: { $push: "$_id" },
          count: { $sum: 1 },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          name: "$_id.name",
          sizeBytes: "$_id.size",
          fileIds: 1,
          count: 1,
        },
      },
      {
        $sort: { count: -1 },
      },
    ]);

    const totalGroups = duplicates.length;

    const totalDuplicateFiles = duplicates.reduce(
      (sum, group) => sum + group.count,
      0,
    );

    const wastedBytes = duplicates.reduce(
      (sum, group) => sum + (group.count - 1) * group.sizeBytes,
      0,
    );

    return res.json({
      totalGroups,
      totalDuplicateFiles,
      wastedBytes,
      groups: duplicates,
    });
  } catch (err) {
    console.error("Duplicate aggregation error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getLargeOldFiles = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid folder id" });
    }

    const parsed = LargeOldFilesQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0].message,
      });
    }

    const largeOldFileSizeMB = parsed.data.minSizeMB ?? 100;
    const OLD_DAYS = parsed.data.olderThanDays ?? 90;

    const LARGE_OLD_SIZE_BYTES = largeOldFileSizeMB * MB;

    const rootDir = await Directory.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!rootDir) {
      return res.status(404).json({ error: "Folder not found" });
    }

    const subDirs = await Directory.find({
      path: id,
      userId: req.user._id,
    }).select("_id");

    const nestedDirs = [rootDir._id, ...subDirs.map((d) => d._id)];

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - OLD_DAYS);

    const largeOldFiles = await File.find({
      userId: req.user._id,
      parentDirId: { $in: nestedDirs },
      fileSize: { $gte: LARGE_OLD_SIZE_BYTES },
      createdAt: { $lte: oldDate },
    })
      .limit(20)
      .sort({ fileSize: -1 })
      .select("name fileSize createdAt");

    let totalSizeInBytes = 0;

    if (largeOldFiles.length > 0) {
      largeOldFiles.map((e) => {
        totalSizeInBytes += e.fileSize;
      });
    }

    const payload = {
      thresholds: {
        minSizeMB: largeOldFileSizeMB,
        olderThanDays: OLD_DAYS,
      },
      summary: {
        totalFiles: largeOldFiles.length,
        totalSizeInBytes,
      },
      files: largeOldFiles,
    };

    return res.status(200).json(payload);
  } catch (err) {
    console.error("getting old large files aggregation error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getEngagementInsights = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid folder id" });
    }

    const rootDir = await Directory.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!rootDir) {
      return res.status(404).json({ error: "Folder not found" });
    }

    const subDirs = await Directory.find({
      path: id,
      userId: req.user._id,
    }).select("_id");

    const nestedDirs = [rootDir._id, ...subDirs.map((d) => d._id)];

    const files = await File.find({
      userId: req.user._id,
      parentDirId: { $in: nestedDirs },
    }).select("_id");

    const fileIds = files.map((f) => f._id);

    const mostViewed = await Share.find({
      ownerId: new mongoose.Types.ObjectId(req.user._id),
      fileId: { $in: fileIds },
      totalViews: { $gt: 0 },
    })
      .sort({ totalViews: -1 })
      .limit(5)
      .select("fileId totalViews totalDownloads lastAccessedAt")
      .populate("fileId");

    const mostDownloaded = await Share.find({
      ownerId: new mongoose.Types.ObjectId(req.user._id),
      fileId: { $in: fileIds },
      totalDownloads: { $gt: 0 },
    })
      .sort({ totalDownloads: -1 })
      .limit(5)
      .select("fileId totalViews totalDownloads lastAccessedAt")
      .populate("fileId");

    const recentlyActive = await Share.find({
      ownerId: new mongoose.Types.ObjectId(req.user._id),
      fileId: { $in: fileIds },
      lastAccessedAt: { $ne: null },
    })
      .sort({ lastAccessedAt: -1 })
      .limit(5)
      .select("fileId totalViews totalDownloads lastAccessedAt")
      .populate("fileId");

    const summary = await Share.find({
      ownerId: new mongoose.Types.ObjectId(req.user._id),
      fileId: { $in: fileIds },
    })
      .select("-_id totalViews totalDownloads")
      .lean();

    let totalViews = 0;
    let totalDownloads = 0;

    summary.map((file) => {
      totalViews += file.totalViews;
      totalDownloads += file.totalDownloads;
    });

    const payload = {
      engagement: {
        mostViewed: mostViewed,
        mostDownloaded: mostDownloaded,
        recentlyActive: recentlyActive,
        summary: {
          totalDownloads,
          totalViews,
        },
      },
    };

    return res.status(200).json(payload);
  } catch (err) {
    console.error("Engagement data aggregation error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
