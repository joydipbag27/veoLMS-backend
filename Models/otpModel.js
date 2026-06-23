import { model, Schema } from "mongoose";

const otpSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
    },
    otp: {
      type: String,
    },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 10 * 60 * 1000),
      expires: 0,
    },
    purpose: {
      type: String,
      enum: ["REGISTER", "CHANGE_PASSWORD", "FORGOT_PASSWORD", "SET_PASSWORD"],
      required: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isEmailRegistered: {
      type: Boolean,
      default: false,
    },
  },
  {
    strict: "throw",
  },
);

otpSchema.index({ email: 1, purpose: 1 }, { unique: true });

const OTP = model("OTP", otpSchema);
export default OTP;
