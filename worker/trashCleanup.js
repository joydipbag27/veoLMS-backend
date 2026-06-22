import cron from "node-cron";
import File from "../Models/fileModel.js";
import { permanentlyDeleteMultipleFromB2 } from "../config/s3Client.js";
import { deleteThumbnail } from "../services/thumbnailService.js";

console.log("Trash cleanup worker loaded");

cron.schedule(
  "0 12 * * *", // every day at 12 PM
  async () => {
    console.log("🗑️ Trash auto-delete started");

    try {
      const now = new Date();
      const BATCH_SIZE = 100;

      while (true) {
        const expiredFiles = await File.find({
          isTrashed: true,
          deletedAt: { $lte: now },
        })
          .select("extension fileType userId")
          .limit(BATCH_SIZE)
          .lean();

        if (expiredFiles.length === 0) {
          console.log("No expired files found");
          break;
        }

        const objects = expiredFiles.map(
          (file) => `${file._id}${file.extension}`,
        );

        const fileIds = expiredFiles.map((f) => f._id);

        try {
          await permanentlyDeleteMultipleFromB2(objects);
          await File.deleteMany({ _id: { $in: fileIds } });

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
            `Deleted batch of ${expiredFiles.length} files, ${imageFiles.length} thumbnails`,
          );
        } catch (error) {
          console.error(`File deletion failed`);
          break;
        }
      }
    } catch (error) {
      console.error("Trash cleanup cron failed", error);
    }
  },
  {
    timezone: "Asia/Kolkata",
  },
);
