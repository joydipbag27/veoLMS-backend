import express from "express";
import {
  getDuplicateInsights,
  getEngagementInsights,
  getFolderInsights,
  getLargeOldFiles,
  getStorageInsights,
} from "../Controllers/insightController.js";
import { customRateLimit } from "../middlewares/rateLimit.js";

const router = express.Router();

router.get("/storage", customRateLimit(1, 10), getStorageInsights);

router.get("/folder/:id", customRateLimit(1, 10), getFolderInsights);

router.get(
  "/folder/:id/duplicates",
  customRateLimit(1, 10),
  getDuplicateInsights,
);

router.get("/folder/:id/large-old", customRateLimit(1, 10), getLargeOldFiles);

router.get(
  "/folder/:id/engagement",
  customRateLimit(1, 10),
  getEngagementInsights,
);

export default router;
