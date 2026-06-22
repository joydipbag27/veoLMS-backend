import express from "express";
import {
  createShareData,
  getAllSharedData,
  getShareData,
  publicShareInfo,
  removeShareData,
} from "../Controllers/shareController.js";
import {checkAuth, checkIfBlocked} from "../middlewares/authMiddleware.js";
import { customRateLimit } from "../middlewares/rateLimit.js";

export const router = express.Router();

router.get("/file/:fileId",customRateLimit(1, 20), checkAuth, checkIfBlocked, getShareData);

router.post("/create",customRateLimit(1, 5), checkAuth, checkIfBlocked, createShareData);

router.delete("/file/remove",customRateLimit(1, 5), checkAuth, checkIfBlocked, removeShareData);

router.get("/public/:token",customRateLimit(1, 10), publicShareInfo);

router.get("/me/shared-files",customRateLimit(1, 20), checkAuth, checkIfBlocked, getAllSharedData )

export default router;
