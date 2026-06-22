import Subscription from "../models/subscriptionModel.js";
import { connectDB } from "../db.js";
import mongoose from "mongoose";
import { sendDeletionWarningEmail } from "../services/email/sendWarningEmail.js";
import User from "../models/userModel.js";

export const handler = async () => {
  console.log("⚠️ Warning notification worker started");

  try {
    // Validate required environment variables
    const requiredVars = ["DB_URL"];
    const missingVars = requiredVars.filter((v) => !process.env[v]);
    if (missingVars.length > 0) {
      throw new Error(
        `Missing environment variables: ${missingVars.join(", ")}`,
      );
    }

    await connectDB();

    const MAX_EXECUTION_MS = 14 * 60 * 1000; // 14 minutes safety margin
    const startTime = Date.now();
    let usersWarned = 0;

    const now = new Date();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    // Find subscriptions that need warning
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
    }).lean();

    if (!usersToWarn.length) {
      console.log("✓ No users to warn");
      return {
        statusCode: 200,
        body: {
          message: "No users to warn",
          usersWarned: 0,
        },
      };
    }

    console.log(`Found ${usersToWarn.length} subscriptions to warn`);

    // 🔒 SAFETY CHECK: Get all active subscriptions in one query
    const userIds = usersToWarn.map((s) => s.userId);
    const activeSubs = await Subscription.find({
      userId: { $in: userIds },
      status: { $in: ["active", "in_grace"] },
    }).lean();

    const activeUserSet = new Set(activeSubs.map((s) => s.userId.toString()));

    for (const sub of usersToWarn) {
      // Check timeout
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        console.log("⏱️ Approaching Lambda timeout, stopping warnings");
        break;
      }

      // 🛑 Skip if user has active subscription
      if (activeUserSet.has(sub.userId.toString())) {
        console.log(`⏭️ Skipping ${sub.userId} (has active subscription)`);
        continue;
      }

      // 🛑 Idempotency check
      if (sub.deletionWarningSent === true) {
        console.log(`⏭️ Skipping ${sub.userId} (warning already sent)`);
        continue;
      }

      try {
        // Calculate deletion date (15 days from now)
        const deletionDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
        const deletionScheduledAt = deletionDate.toISOString();
        console.log(
          `📧 Sending warning to user ${sub.userId}: Files will be deleted on ${deletionDate.toISOString()}`,
        );

        const userInfo = await User.findById(sub.userId);
        if (!userInfo) {
          console.warn(`❌ User not found for subscription ${sub._id}`);
          continue;
        }
        const userEmail = userInfo.email;

        const emailResult = await sendDeletionWarningEmail(
          userEmail,
          deletionScheduledAt,
          userInfo._id,
        );

        if (!emailResult.success) {
          console.error(
            `❌ Failed to send email to ${userEmail}:`,
            emailResult.error,
          );
          continue;
        }

        // Mark warning as sent and schedule deletion (with idempotency check)
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
          console.log(`⏭️ Subscription already processed for ${sub.userId}`);
          continue;
        }

        usersWarned++;
        console.log(`✅ Warning sent to user ${sub.userId}`);
      } catch (err) {
        console.error(`❌ Failed to warn user ${sub.userId}:`, err.message);
        // Continue with next user on error
      }
    }

    console.log(
      `✅ Warning notifications complete: ${usersWarned} users warned`,
    );
    return {
      statusCode: 200,
      body: {
        message: "Warning notifications successful",
        usersWarned,
      },
    };
  } catch (error) {
    console.error("❌ Warning notification worker failed:", error.message);
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
