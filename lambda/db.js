import mongoose from "mongoose";

let isConnected = false;

export const connectDB = async () => {
  if (isConnected) {
    console.log("Using existing DB connection");
    return;
  }

  if (!process.env.DB_URL) {
    throw new Error("DB_URL environment variable is not set");
  }

  try {
    await mongoose.connect(process.env.DB_URL, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    isConnected = true;
    console.log("✓ DB Connected");
  } catch (error) {
    isConnected = false;
    throw new Error(`Database connection failed: ${error.message}`);
  }
};
