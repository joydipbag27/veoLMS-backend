import express from "express";
import {
  clearAllNotification,
  getNotification,
  getUnreadCount,
  markAllAsRead,
  markAsRead,
} from "../Controllers/notificationController.js";
import { customRateLimit } from "../middlewares/rateLimit.js";

const router = express.Router();

router.get("/", customRateLimit(1, 20), getNotification);
router.get("/unread-count", customRateLimit(1, 20), getUnreadCount);
router.patch("/:id/read", customRateLimit(1, 25), markAsRead);
router.patch("/all-read", customRateLimit(1, 10), markAllAsRead);
router.delete("/clear", customRateLimit(1, 10), clearAllNotification);

export default router;
