import Subscription from "../Models/subscriptionModel.js";
import User from "../Models/userModel.js";

export const syncUserPlan = async (userId) => {
  const subscriptionInfo = await Subscription.findOne({
    userId,
    status: { $in: ["active", "in_grace"] },
  });

  if (subscriptionInfo) {
    await User.findOneAndUpdate(
      { _id: userId },
      { $set: { planId: subscriptionInfo.planId } },
    );
  } else {
    await User.findOneAndUpdate(
      { _id: userId },
      { $set: { planId: "spark_free" } },
    );
  }
  return;
};
