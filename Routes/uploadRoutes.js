import express from "express";
import {
  getUploadUrl,
  getDownloadUrl,
} from "../Controllers/uploadController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { customRateLimit } from "../middlewares/rateLimit.js";

const router = express.Router();

router.post(
  "/upload-url",
  customRateLimit(1, 15),
  authenticate,
  getUploadUrl,
);
router.get(
  "/download-url/:key",
  customRateLimit(1, 30),
  authenticate,
  getDownloadUrl,
);

export default router;
