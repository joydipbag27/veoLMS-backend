import { createClient } from "redis";

export const redisClient = await createClient({
  url: process.env.REDIS_URL,
  database: Number(process.env.REDIS_DB) || 0,
}).connect();

redisClient.on("error", (err) => {
  console.log("Redis Client Error", err);
  process.exit(1);
});
