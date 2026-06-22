import cron from "node-cron";
import Subscription from "../Models/subscriptionModel.js";
import User from "../Models/userModel.js";
import { sendDeletionWarningEmail } from "../services/email/sendWarningEmail.js";

console.log("Auto warning worker started");

cron.schedule(
  "0 2 * * *",
  async () => {
    console.log("Finding users to warn");

    try {
      const now = new Date();
      const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
      let usersWarned = 0;

      const usersToWarn = await Subscription.find({
        $or: [
          {
            status: "cancelled",
            cancelledAt: { $ne: null, $lte: sevenDaysAgo },
          },
          {
            status: "in_grace",
            gracePeriodEndsAt: { $lte: now },
          },
        ],
        deletionWarningSent: { $ne: true },
        filesDeleted: { $ne: true },
      });

      if (!usersToWarn.length) {
        console.log("✓ No users to warn");
        return;
      }

      console.log(`Found ${usersToWarn.length} subscriptions to warn`);
      // 🔒 SAFETY CHECK
      const activeSubs = await Subscription.find({
        userId: { $in: userIds },
        status: { $in: ["active", "in_grace"] },
      });

      const activeUserSet = new Set(activeSubs.map((s) => s.userId.toString()));

      for (const sub of usersToWarn) {
        if (activeUserSet.has(sub.userId.toString())) {
          console.log(`Skipping ${sub.userId} (active subscription)`);
          continue;
        }

        try {
          const deletionDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

          // Fetch user to get email
          const user = await User.findById(sub.userId);
          if (!user) {
            console.warn(`User not found for subscription ${sub._id}`);
            continue;
          }

          console.log(
            `📧 Sending warning to ${user.email} - Files will be deleted on ${deletionDate}`,
          );

          // Send deletion warning email
          const emailResult = await sendDeletionWarningEmail(
            user.email,
            deletionDate.toISOString(),
            sub.userId,
          );

          if (!emailResult.success) {
            console.error(
              `Failed to send email to ${user.email}:`,
              emailResult.error,
            );
            continue;
          }

          // Mark warning as sent and schedule deletion
          const result = await Subscription.updateOne(
            {
              _id: sub._id,
              deletionWarningSent: { $ne: true },
            },
            {
              deletionWarningSent: true,
              deletionScheduledAt: deletionDate,
            },
          );

          if (result.modifiedCount === 0) {
            console.log(`Subscription already processed for ${sub.userId}`);
            continue;
          }

          usersWarned++;
          console.log(`✅ Warning sent to ${user.email}`);
        } catch (error) {
          console.error(`Failed to process user ${sub.userId}:`, error.message);
          continue;
        }
      }

      console.log(
        `✅ Warning notifications complete: ${usersWarned} users warned`,
      );
    } catch (error) {
      console.error("Auto warning worker failed", error);
    }
  },
  {
    timezone: "Asia/Kolkata",
  },
);
