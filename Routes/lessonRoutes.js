import express from "express";
import {
  createLesson,
  getLessonsBySection,
  getMyLessonsBySection,
  getLessonById,
  getMyLessonById,
  updateLesson,
  deleteLesson,
} from "../Controllers/lessonController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { roles } from "../config/roles.js";
import { customRateLimit } from "../middlewares/rateLimit.js";

const router = express.Router();

router.post(
  "/",
  customRateLimit(1, 10),
  authenticate,
  authorize(roles.CREATOR, roles.ADMIN),
  createLesson,
);

router.get("/section/:sectionId", getLessonsBySection);

router.get(
  "/creator/section/:sectionId",
  authenticate,
  authorize(roles.CREATOR, roles.ADMIN),
  getMyLessonsBySection,
);

router.get(
  "/creator/:id",
  authenticate,
  authorize(roles.CREATOR, roles.ADMIN),
  getMyLessonById,
);

router.get("/:id", getLessonById);

router.patch(
  "/:id",
  customRateLimit(1, 10),
  authenticate,
  authorize(roles.CREATOR, roles.ADMIN),
  updateLesson,
);

router.delete(
  "/:id",
  customRateLimit(1, 10),
  authenticate,
  authorize(roles.CREATOR, roles.ADMIN),
  deleteLesson,
);

export default router;
