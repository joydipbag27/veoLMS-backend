import express from "express";
import {
  adminReadPrivilegesAuth,
  adminFileCRUDPermission,
  adminWritePrivilegesAuth,
} from "../middlewares/authMiddleware.js";
import {
  adminBlock,
  adminDelete,
  adminLogout,
  changeRole,
  getAllUsers,
  usersDirectoryRename,
  usersDirectoryDelete,
  usersFileViewAndDownload,
  usersFileRename,
  usersFileDelete,
  getUsersDirectories,
  getUsersFiles,
  getSessionStatus,
} from "../Controllers/rbacController.js";
import { customRateLimit } from "../middlewares/rateLimit.js";

const router = express.Router();

router.get("/", customRateLimit(1, 5), adminReadPrivilegesAuth, getAllUsers);

router.get(
  "/session/:id",
  customRateLimit(1, 20),
  adminReadPrivilegesAuth,
  getSessionStatus,
);

router.post(
  "/logout",
  customRateLimit(1, 1),
  adminReadPrivilegesAuth,
  adminLogout,
);

router.delete(
  "/delete",
  customRateLimit(1, 1),
  adminWritePrivilegesAuth,
  adminDelete,
);

router.patch(
  "/block",
  customRateLimit(1, 5),
  adminWritePrivilegesAuth,
  adminBlock,
);

router.patch(
  "/role",
  customRateLimit(1, 1),
  adminWritePrivilegesAuth,
  changeRole,
);

router.get(
  "/:userId/directories/:dirId",
  customRateLimit(1, 15),
  adminFileCRUDPermission,
  getUsersDirectories,
);

router.get(
  "/:userId/directories/:dirId/files",
  customRateLimit(1, 15),
  adminFileCRUDPermission,
  getUsersFiles,
);

router.patch(
  "/:userId/directory/:dirId",
  customRateLimit(1, 20),
  adminFileCRUDPermission,
  usersDirectoryRename,
);

router.delete(
  "/:userId/directory/:dirId",
  customRateLimit(1, 1),
  adminFileCRUDPermission,
  usersDirectoryDelete,
);

router.get(
  "/:userId/directory/:dirId/file/:fileId",
  customRateLimit(1, 15),
  adminFileCRUDPermission,
  usersFileViewAndDownload,
);

router.patch(
  "/:userId/directory/:dirId/file/:fileId",
  customRateLimit(1, 20),
  adminFileCRUDPermission,
  usersFileRename,
);

router.delete(
  "/:userId/directory/:dirId/file/:fileId",
  customRateLimit(1, 1),
  adminFileCRUDPermission,
  usersFileDelete,
);

export default router;
