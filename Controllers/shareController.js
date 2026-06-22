import Share from "../Models/shareModel.js";
import File from "../Models/fileModel.js";
import crypto from "crypto";
import mongoose from "mongoose";
import { shareSchema, shareTokenSchema } from "../validators/authSchema.js";
import User from "../Models/userModel.js";
import { PLANS } from "../config/plans.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client } from "../config/s3Client.js";
import { handleCursorPagination } from "../utils/pagination.js";
import { fileCursorConfig } from "../utils/cursorConfig.js";
import { fileSortMap } from "../utils/sortMap.js";

export const getShareData = async (req, res) => {
  const { fileId } = req.params;

  if (!mongoose.isValidObjectId(fileId)) {
    return res.status(400).json({ error: "Invalid fileId" });
  }

  const shareInfo = await Share.findOne({
    fileId,
    ownerId: req.user._id,
  }).lean();

  if (!shareInfo) {
    return res.status(404).json({ error: "Share link not found" });
  }

  res
    .status(200)
    .json({ link: `https://sastadrive.in/share/public/${shareInfo.token}` });
};

export const createShareData = async (req, res) => {
  const { success, data, error } = shareSchema.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ error: error.issues[0].message });
  }
  const { fileId, expiry } = data;

  const existingShareInfo = await Share.findOne({
    fileId,
    ownerId: req.user._id,
  });

  if (existingShareInfo) {
    return res
      .status(500)
      .json({ error: "Existing share data available for this file" });
  }

  const fileInfo = await File.findOne({
    _id: fileId,
    userId: req.user._id,
  }).lean();

  if (!fileInfo) {
    return res.status(404).json({ error: "File not found" });
  }

  const expiryMap = {
    "1h": 1,
    "1d": 24,
    "3d": 72,
    "1w": 168,
    "1m": 720,
  };

  let expiresAt = null;
  if (expiry && expiryMap[expiry]) {
    const hours = expiryMap[expiry];
    expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  const token = crypto.randomBytes(32).toString("hex");

  await Share.create({
    ownerId: req.user._id,
    fileId,
    token,
    sharedWith: ["Public"],
    expiresAt,
    fileType: fileInfo.fileType,
  });

  res.status(200).json({ link: `https://sastadrive.in/share/public/${token}` });
};

export const removeShareData = async (req, res) => {
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
    const result = await Share.deleteMany({
      ownerId: req.user._id,
      fileId: { $in: fileIds },
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        message: "No share access found to remove",
      });
    }

    return res.status(200).json({
      message: "File share access removed successfully",
      removed: result.deletedCount,
    });
  } catch (error) {
    console.error("Remove share access failed", error);
    return res.status(500).json({
      error: "Failed to remove share access",
    });
  }
};

export const publicShareInfo = async (req, res) => {
  const { token } = req.params;
  const { action } = req.query;

  const { success, data, error } = shareTokenSchema.safeParse(token);

  if (!success) {
    return res.status(400).json({ error: error.issues[0].message });
  }

  const shareInfo = await Share.findOne({ token: data });

  if (!shareInfo) {
    return res.status(404).json({ error: "Invalid or expired share link" });
  }

  if (shareInfo.expiresAt && shareInfo.expiresAt < new Date()) {
    return res.status(410).json({ error: "Share link has expired" });
  }

  const fileInfo = await File.findOne({
    _id: shareInfo.fileId,
    userId: shareInfo.ownerId,
  })
    .select("-userId -parentDirId")
    .lean();

  if (!fileInfo) {
    return res.status(500).json({ error: "Can't fetch file Data" });
  }

  const user = await User.findOne({ _id: shareInfo.ownerId });

  if (!user) {
    return res.status(500).json({ error: "Can't fetch owner data" });
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

  const payload = {
    ...fileInfo,
    signedUrl,
    tracking: {
      totalViews: shareInfo.totalViews,
      totalDownloads: shareInfo.totalDownloads,
      lastAccessedAt: shareInfo.lastAccessedAt,
    },
  };
  const now = new Date();

  if (action === "open") {
    await Share.updateOne(
      { token: data },
      {
        $inc: { totalViews: 1 },
        $set: { lastAccessedAt: now },
      },
    );

    return res.status(200).json(payload);
  } else if (action === "download") {
    await Share.updateOne(
      { token: data },
      {
        $inc: { totalDownloads: 1 },
        $set: { lastAccessedAt: now },
      },
    );
    return res.status(200).json(signedUrl);
  } else {
    return res.status(400).json({ error: "Pass correct query!" });
  }
};

//GET ALL SHARED FILES
export const getAllSharedData = async (req, res) => {
  try {
    const { cursor, sort, type } = req.query;
    const allowedSorts = ["date_desc", "date_asc"];
    const safeSort = allowedSorts.includes(sort) ? sort : "date_desc";
    const allowedTypes = ["image", "video", "audio", "document", "other"];

    if (type && !allowedTypes.includes(type)) {
      return res.status(400).json({ error: "Invalid file type" });
    }

    const query = { ownerId: req.user._id };

    if (type) {
      query.fileType = type;
    }

    const { data, nextCursor, hasMore } = await handleCursorPagination({
      model: Share,
      query,
      cursor,
      sort: safeSort,
      limit: 20,
      sortMap: fileSortMap,
      cursorConfig: fileCursorConfig,
    });

    const populatedData = await Share.populate(data, {
      path: "fileId",
    });

    return res.status(200).json({
      shared: populatedData,
      nextCursor,
      hasMore,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch share data" });
  }
};
