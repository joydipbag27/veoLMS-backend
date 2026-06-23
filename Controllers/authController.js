import mongoose from "mongoose";
import crypto from "crypto";
import User from "../Models/userModel.js";
import OTP from "../Models/otpModel.js";
import { googleClient } from "../services/googleAuthService.js";
import { sendEmail } from "../services/email/sendEmailOtp.js";
import { redisClient } from "../config/redis.js";
import { sendOtpSchema, verifyOtpSchema } from "../validators/authSchema.js";

export const sendOtp = async (req, res) => {
  const { success, data, error } = sendOtpSchema.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ error: error.issues[0].message });
  }
  const { email, purpose } = data;

  // Purpose-specific pre-send validations
  try {
    if (purpose === "REGISTER") {
      const existingUser = await User.findOne({ email }).lean();
      if (existingUser) {
        return res.status(400).json({ error: "User already exists with this email" });
      }
    }

    if (purpose === "FORGOT_PASSWORD") {
      const existingUser = await User.findOne({ email }).lean();
      if (!existingUser) {
        return res.status(404).json({ error: "User not found with this email" });
      }
    }

    if (purpose === "CHANGE_PASSWORD" || purpose === "SET_PASSWORD") {
      const { sid } = req.signedCookies;
      if (!sid) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const session = await redisClient.json.get(`session:${sid}`);
      if (!session || !session.userId) {
        return res.status(401).json({ error: "Session expired or invalid" });
      }
      const user = await User.findById(session.userId).lean();
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      if (user.email !== email) {
        return res.status(403).json({ error: "Session email does not match requested email" });
      }
    }

    // Check Cooldown period (1 minute)
    const existingOtp = await OTP.findOne({ email, purpose });
    if (existingOtp) {
      const now = Date.now();
      const coolDownPeriod = new Date(existingOtp.createdAt).getTime() + 60000;
      if (now < coolDownPeriod) {
        return res.status(400).json({ error: "Please wait before requesting another OTP" });
      }
    }

    // Generate 6-digit OTP
    const otp = crypto.randomInt(100000, 999999).toString();

    // Upsert to DB as unverified
    await OTP.findOneAndUpdate(
      { email, purpose },
      {
        email,
        otp,
        purpose,
        isVerified: false,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        createdAt: new Date(),
      },
      { upsert: true }
    );

    // Send email
    const mailResult = await sendEmail(email, purpose, otp);
    if (!mailResult.success) {
      await OTP.findOneAndDelete({ email, purpose });
      return res.status(500).json({ error: mailResult.error });
    }

    return res.status(200).json({ message: `OTP sent to ${email}` });
  } catch (error) {
    console.error("Error in sendOtp:", error);
    return res.status(500).json({ error: "Failed to send OTP. Please try again." });
  }
};

export const verifyOtp = async (req, res) => {
  const { success, data, error } = verifyOtpSchema.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ error: error.issues[0].message });
  }
  const { email, otp, purpose } = data;

  try {
    // Session email authorization for change/set password
    if (purpose === "CHANGE_PASSWORD" || purpose === "SET_PASSWORD") {
      const { sid } = req.signedCookies;
      if (!sid) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const session = await redisClient.json.get(`session:${sid}`);
      if (!session || !session.userId) {
        return res.status(401).json({ error: "Session expired or invalid" });
      }
      const user = await User.findById(session.userId).lean();
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      if (user.email !== email) {
        return res.status(403).json({ error: "Session email does not match requested email" });
      }
    }

    const isMatched = await OTP.findOne({ email, otp, purpose });
    if (!isMatched) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    const setQuery = { isVerified: true };
    if (purpose === "FORGOT_PASSWORD") {
      const existingUser = await User.findOne({ email });
      setQuery.isEmailRegistered = !!existingUser;
    }

    await OTP.findOneAndUpdate(
      { email, purpose, otp },
      { $set: setQuery }
    );

    return res.status(200).json({ message: "OTP verified successfully" });
  } catch (error) {
    console.error("Error in verifyOtp:", error);
    return res.status(500).json({ error: "Failed to verify OTP" });
  }
};

export const loginWithGoogle = async (req, res, next) => {
  const { idToken } = req.body;

  if (typeof idToken !== "string") {
    return res.status(400).json({ error: "Invalid token" });
  }

  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: googleClient._clientId,
  });

  const user = ticket.getPayload();

  if (!user?.email || !user.email_verified) {
    return res.status(401).json({ error: "Unverified Google account" });
  }

  const existingUser = await User.findOne({ email: user.email });

  if (!existingUser) {
    try {
      const userId = new mongoose.Types.ObjectId();

      const newUser = await User.create({
        _id: userId,
        username: user.name,
        email: user.email,
      });

      const sessionId = crypto.randomUUID();
      await redisClient
        .multi()
        .json.set(`session:${sessionId}`, "$", {
          userId: newUser._id,
          role: newUser.role,
          isBlocked: newUser.isBlocked,
          isPassAvailable: !!newUser.password,
        })
        .expire(`session:${sessionId}`, 60 * 60 * 24 * 7)
        .exec();

      res.cookie("sid", sessionId, {
        httpOnly: true,
        signed: true,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24 * 7,
      });
    } catch (error) {
      console.log(error);
      next();
    }
  }

  //LOGIN
  if (existingUser) {
    if (existingUser.isBlocked) {
      return res.status(403).json({
        message:
          "Your account has been banned. Please contact support if you believe this is a mistake",
      });
    }
    try {
      const allSessions = await redisClient.ft.search(
        "userIdIndex",
        `@userId:{${existingUser._id}}`,
        { RETURN: [] },
      );

      if (allSessions.total >= 2) {
        await redisClient.del(allSessions.documents[0].id);
      }

      const sessionId = crypto.randomUUID();
      await redisClient
        .multi()
        .json.set(`session:${sessionId}`, "$", {
          userId: existingUser._id,
          role: existingUser.role,
          isBlocked: existingUser.isBlocked,
          isPassAvailable: !!existingUser.password,
        })
        .expire(`session:${sessionId}`, 60 * 60 * 24 * 7)
        .exec();

      res.cookie("sid", sessionId, {
        httpOnly: true,
        signed: true,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24 * 7,
      });
    } catch (error) {
      console.log(error);
    }
  }

  res.status(200).json({ message: "User logged in" });
};
