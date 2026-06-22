import File from "../models/fileModel.js";
import { permanentlyDeleteMultipleFromB2 } from "../s3Client.js";
import { connectDB } from "../db.js";
import mongoose from "mongoose";
import { deleteThumbnail } from "../thumbnailClient.js";


export const handler = async () => {
  console.log("🗑️ Trash auto-delete started");

  try {
    // Validate required environment variables
    const requiredVars = [
      "DB_URL",
      "BUCKET_NAME",
      "BLACK_BLAZE_ENDPOINT",
      "BLACK_BLAZE_REGION",
    ];
    const missingVars = requiredVars.filter((v) => !process.env[v]);
    if (missingVars.length > 0) {
      throw new Error(
        `Missing environment variables: ${missingVars.join(", ")}`,
      );
    }

    await connectDB();

    const now = new Date();
    const BATCH_SIZE = 100;
    const MAX_EXECUTION_MS = 14 * 60 * 1000; // 14 minutes safety margin for 15-minute timeout
    const startTime = Date.now();
    let totalDeleted = 0;
    let batchCount = 0;

    while (true) {
      // Check if approaching timeout
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        console.log("⏱️ Approaching Lambda timeout limit, stopping cleanup");
        break;
      }

      const expiredFiles = await File.find({
        isTrashed: true,
        deletedAt: { $lte: now },
      })
        .select("extension fileType userId")
        .limit(BATCH_SIZE)
        .lean();

      if (expiredFiles.length === 0) {
        console.log("✓ No expired files found");
        break;
      }

      const objects = expiredFiles.map(
        (file) => `${file._id}${file.extension}`,
      );

      const fileIds = expiredFiles.map((f) => f._id);

      try {
        await permanentlyDeleteMultipleFromB2(objects);
        await File.deleteMany({ _id: { $in: fileIds } });

        batchCount++;
        totalDeleted += expiredFiles.length;
        console.log(
          `✓ Batch ${batchCount}: Deleted ${expiredFiles.length} files (Total: ${totalDeleted})`,
        );
      } catch (error) {
        console.error(
          `❌ B2 deletion failed for batch ${batchCount}, objects:`,
          objects,
        );
        console.error("Error details:", error.message);
        break
      }

      try {
        const imageFiles = expiredFiles.filter(
          (file) => file.fileType === "image" || file.fileType === "video",
        );

        await Promise.all(
          imageFiles.map((file) =>
            deleteThumbnail(
              file._id.toString(),
              file.userId.toString(),
              file.extension,
            ),
          ),
        );

        console.log(
          `✓ Batch ${batchCount}: Deleted ${imageFiles.length} thumbnails (Total: ${totalDeleted})`,
        );
      } catch (error) {
        console.error(
          `❌ thumbnail deletion failed for batch ${batchCount}, objects:`,
          objects,
        );
        console.error("Error details:", error.message);
        break;
      }
    }

    console.log(
      `✅ Trash cleanup complete: ${totalDeleted} files permanently deleted in ${batchCount} batches`,
    );
    return {
      statusCode: 200,
      body: {
        message: "Trash cleanup successful",
        totalDeleted,
        batchCount,
      },
    };
  } catch (error) {
    console.error("❌ Trash cleanup failed:", error.message);
    return {
      statusCode: 500,
      body: { error: error.message },
    };
  } finally {
    try {
      await mongoose.disconnect();
      console.log("DB disconnected");
    } catch (error) {
      console.error("Error disconnecting from DB:", error.message);
    }
  }
};
