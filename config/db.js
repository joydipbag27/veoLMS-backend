import "dotenv/config";
import mongoose from "mongoose";

export async function ConnectDB() {
  try {
    await mongoose.connect(process.env.DB_URL);
    console.log("Database Connected");
  } catch (error) {
    console.log(error);
    console.log("Could not connect to the Database");
    process.exit(1)
  }
}

process.on("SIGINT", async() => {
    await mongoose.disconnect()
    console.log("Database Disconnected");
    process.exit(0)
})