import express from "express";
import {
  bulkRemoveFromFav,
  cancelUpload,
  createPutSignedUrl,
  fileMove,
  FileRename,
  finalizeFileUpload,
  getAllFavorites,
  getAllFiles,
  getAllTrash,
  getRecentFiles,
  moveToTrash,
  multipleDelete,
  restoreFromTrash,
  toggleFavorite,
  WatchAndDownload,
} from "../Controllers/fileController.js";
import { customRateLimit } from "../middlewares/rateLimit.js";

export const router = express.Router();

//UPLOAD LIFECYCLE
router.post("/upload/initiate", customRateLimit(1, 10), createPutSignedUrl);
router.patch("/upload/complete", customRateLimit(1, 10), finalizeFileUpload);
router.patch("/upload/cancel", customRateLimit(1, 15), cancelUpload);

//USER COLLECTIONS
router.get("/me/files", customRateLimit(1, 20), getAllFiles);
router.get("/me/trash", customRateLimit(1, 20), getAllTrash);
router.get("/me/favorites", customRateLimit(1, 20), getAllFavorites);

//BULK OPERATIONS
router.delete("/bulk", customRateLimit(1, 4), multipleDelete);
router.delete("/bulk/favorites", customRateLimit(1, 10), bulkRemoveFromFav);
router.post("/bulk/move", customRateLimit(1, 4), fileMove)

//TRASH ACTIONS BULK
router.patch("/trash", customRateLimit(1, 10), moveToTrash);
router.post("/restore", customRateLimit(1, 10), restoreFromTrash);

//FILE ACTIONS
router.get("/:id", customRateLimit(1, 10), WatchAndDownload);
router.patch("/:id", customRateLimit(1, 20), FileRename);
router.patch("/:id/favorite", customRateLimit(1, 30), toggleFavorite);

//FILE INSIGNTS
router.get("/insights/recent", customRateLimit(1, 15), getRecentFiles)

export default router;
