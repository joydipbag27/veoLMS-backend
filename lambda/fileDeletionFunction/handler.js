import Subscription from "../models/subscriptionModel.js";
import { permanentlyDeleteMultipleFromB2 } from "../s3Client.js";
import Directory from "../models/directoryModel.js";
import Share from "../models/shareModel.js";
import File from "../models/fileModel.js";
import { connectDB } from "../db.js";
import mongoose from "mongoose";
import { deleteThumbnail } from "../thumbnailClient.js";


export const handler = async () => {
  console.log("🗑️ File deletion worker started");

  try {
    // Validate required environment variables
    const requiredVars = ["DB_URL", "BUCKET_NAME"];
    const missingVars = requiredVars.filter((v) => !process.env[v]);
    if (missingVars.length > 0) {
      throw new Error(
        `Missing environment variables: ${missingVars.join(", ")}`,
      );
    }

    await connectDB();

    const MAX_EXECUTION_MS = 14 * 60 * 1000; // 14 minutes safety margin
    const startTime = Date.now();
    let usersProcessed = 0;
    let filesDeleted = 0;

    const now = new Date();

    // Get subscriptions scheduled for deletion (deduplicated by user)
    const allSubs = await Subscription.find({
      deletionScheduledAt: { $lte: now },
      filesDeleted: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!allSubs.length) {
      console.log("✓ No subscriptions scheduled for deletion");
      return {
        statusCode: 200,
        body: {
          message: "No subscriptions to process",
          usersProcessed: 0,
          filesDeleted: 0,
        },
      };
    }

    const latestSubMap = new Map();
    for (const sub of allSubs) {
      const userId = sub.userId.toString();
      if (!latestSubMap.has(userId)) {
        latestSubMap.set(userId, sub);
      }
    }

    const subsToDelete = Array.from(latestSubMap.values());
    const userIds = [...new Set(subsToDelete.map((s) => s.userId.toString()))];

    // 🔒 SAFETY CHECK: Get all active subscriptions for these users in one query
    const activeSubs = await Subscription.find({
      userId: { $in: userIds },
      status: { $in: ["active", "in_grace"] },
    }).lean();

    const activeUserSet = new Set(activeSubs.map((s) => s.userId.toString()));

    console.log(
      `Processing ${subsToDelete.length} subscriptions for file deletion`,
    );

    for (const sub of subsToDelete) {
      // Check timeout
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        console.log("⏱️ Approaching Lambda timeout, stopping file deletion");
        break;
      }

      const userId = sub.userId.toString();

      // 🛑 Skip if user has active subscription
      if (activeUserSet.has(userId)) {
        console.log(`⏭️ Skipping ${userId} (has active subscription)`);
        continue;
      }

      // 🛑 Idempotency check
      if (sub.filesDeleted === true) {
        console.log(`⏭️ Skipping ${userId} (files already deleted)`);
        continue;
      }

      try {
        console.log(`📁 Processing files for user ${userId}`);

        // Get all files for this user
        const fileInfos = await File.find({ userId })
          .select("extension fileType")
          .lean();

        // Delete from B2 storage
        if (fileInfos.length > 0) {
          const objects = fileInfos.map(
            (file) => `${file._id}${file.extension}`,
          );
          console.log(
            `📦 Deleting ${objects.length} files from B2 for user ${userId}`,
          );

          try {
            await permanentlyDeleteMultipleFromB2(objects);
          } catch (err) {
            console.error(`❌ B2 deletion failed for ${userId}:`, err.message);
            continue; // Skip this user on B2 failure
          }

          filesDeleted += fileInfos.length;
        }

        if (fileInfos.length > 0) {
          await Promise.all(
            fileInfos
              .filter((file) => file.fileType === "image" || file.fileType === "video")
              .map((file) =>
                deleteThumbnail(
                  file._id.toString(),
                  userId,
                  file.extension,
                ),
              ),
          );
        }

        // Delete from MongoDB
        await File.deleteMany({ userId });
        await Share.deleteMany({ ownerId: userId });

        // Get root directory
        const rootDir = await Directory.findOne({
          userId,
          parentDirId: null,
        }).lean();

        if (!rootDir) {
          console.error(`⚠️ Root directory missing for user ${userId}`);
          continue;
        }

        // Delete all non-root directories
        await Directory.deleteMany({ userId, _id: { $ne: rootDir._id } });

        // Reset root directory stats
        await Directory.updateOne(
          { _id: rootDir._id },
          {
            directorySize: 0,
            fileCount: 0,
          },
        );

        // Mark subscription as processed (with idempotency check)
        const result = await Subscription.updateOne(
          {
            _id: sub._id,
            filesDeleted: { $ne: true },
          },
          {
            filesDeleted: true,
            filesDeletedAt: new Date(),
          },
        );

        if (result.modifiedCount === 0) {
          console.log(`⏭️ Subscription already processed for ${userId}`);
          continue;
        }

        usersProcessed++;
        console.log(`✅ Files deleted for user ${userId}`);
      } catch (err) {
        console.error(`❌ Failed processing ${userId}:`, err.message);
        // Continue with next user on error
      }
    }

    console.log(
      `✅ File deletion complete: ${usersProcessed} users, ${filesDeleted} files`,
    );
    return {
      statusCode: 200,
      body: {
        message: "File deletion successful",
        usersProcessed,
        filesDeleted,
      },
    };
  } catch (error) {
    console.error("❌ File deletion worker failed:", error.message);
    return {
      statusCode: 500,
      body: { error: error.message },
    };
  } finally {
    // Always disconnect from database
    try {
      await mongoose.disconnect();
      console.log("DB disconnected");
    } catch (error) {
      console.error("Error disconnecting from DB:", error.message);
    }
  }
};
