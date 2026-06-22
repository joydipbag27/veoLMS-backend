import express from "express";
import {
  CreateDirectory,
  DeleteDirectory,
  getAllFolders,
  GetDirectoryById,
  getDirectoryFiles,
  RenameDirectory,
} from "../Controllers/directoryController.js";
import { customRateLimit } from "../middlewares/rateLimit.js";

export const router = express.Router();

router.get("/files{/:id}", customRateLimit(1, 15), getDirectoryFiles);

router.get("{/:id}", customRateLimit(1, 15), GetDirectoryById);

router.post("/{:parentDirId}", customRateLimit(1, 5), CreateDirectory);

router.patch("/{:id}", customRateLimit(1, 20), RenameDirectory);

router.delete("/{:id}", customRateLimit(1, 3), DeleteDirectory);

router.get("/meta/all-folders", customRateLimit(1, 15), getAllFolders);

export default router;
