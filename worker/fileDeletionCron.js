import cron from "node-cron";
import Subscription from "../Models/subscriptionModel.js";
import { permanentlyDeleteMultipleFromB2 } from "../config/s3Client.js";
import Directory from "../Models/directoryModel.js";
import Share from "../Models/shareModel.js";
import File from "../Models/fileModel.js";
import { deleteThumbnail } from "../services/thumbnailService.js";

console.log("Auto deletion worker started");

cron.schedule(
  "0 3 * * *",
  async () => {
    console.log("Finding users for file deletion");

    try {
      const now = new Date();

      const allSubs = await Subscription.find({
        deletionScheduledAt: { $lte: now },
        filesDeleted: { $ne: true },
      })
        .sort({ createdAt: -1 })
        .lean();

      if (!allSubs.length) return;

      const latestSubMap = new Map();

      for (const sub of allSubs) {
        const userId = sub.userId.toString();

        if (!latestSubMap.has(userId)) {
          latestSubMap.set(userId, sub);
        }
      }

      const subsToDelete = Array.from(latestSubMap.values());

      if (!subsToDelete.length) return;

      const userIds = [
        ...new Set(subsToDelete.map((s) => s.userId.toString())),
      ];

      // 🔒 SAFETY CHECK (bulk)
      const activeSubs = await Subscription.find({
        userId: { $in: userIds },
        status: { $in: ["active", "in_grace"] },
      }).lean();

      const activeUserSet = new Set(activeSubs.map((s) => s.userId.toString()));

      for (const sub of subsToDelete) {
        const userId = sub.userId.toString();

        // 🛑 Skip if user became active again
        if (activeUserSet.has(userId)) {
          console.log(`Skipping ${userId} (active subscription)`);
          continue;
        }

        // 🛑 Idempotency check
        if (sub.filesDeleted === true) continue;

        try {
          console.log(`Deleting files for user ${userId}`);

          const fileInfos = await File.find({
            userId: userId,
          })
            .select("extension fileType")
            .lean();

          if (fileInfos.length > 0) {
            const objects = fileInfos.map(
              (file) => `${file._id}${file.extension}`,
            );
            console.log(`Deleting ${objects.length} files for user ${userId}`);

            try {
              await permanentlyDeleteMultipleFromB2(objects);
            } catch (err) {
              console.error(`B2 deletion failed, ${userId}`, err);
              continue; // skip this user
            }

            await Promise.all(
              fileInfos
                .filter((file) => file.fileType === "image" || file.fileType === "video")
                .map((file) =>
                  deleteThumbnail(file._id.toString(), userId, file.extension),
                ),
            );
          }

          await File.deleteMany({ userId });

          await Share.deleteMany({
            ownerId: userId,
          });

          const rootDir = await Directory.findOne({
            userId,
            parentDirId: null,
          }).lean();

          if (!rootDir) {
            console.error(`Root directory missing for user ${userId}`);
            continue;
          }

          await Directory.deleteMany({ userId, _id: { $ne: rootDir._id } });

          await Directory.updateOne(
            { _id: rootDir._id },
            {
              directorySize: 0,
              fileCount: 0,
            },
          );

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

          if (result.modifiedCount === 0) continue;

          console.log(`Files deleted for user ${userId}`);
        } catch (err) {
          console.error(`Failed deleting files for ${userId}`, err);
        }
      }
    } catch (error) {
      console.error("Auto deletion worker failed", error);
    }
  },
  {
    timezone: "Asia/Kolkata",
  },
);
