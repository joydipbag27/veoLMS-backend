import express from "express";
import {
  createCourse,
  getCourses,
  getMyCourses,
  getCourseById,
  updateCourse,
  deleteCourse,
} from "../Controllers/courseController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { roles } from "../config/roles.js";
import { customRateLimit } from "../middlewares/rateLimit.js";

const router = express.Router();

router.post(
  "/",
  customRateLimit(1, 5),
  authenticate,
  authorize(roles.CREATOR, roles.ADMIN),
  createCourse,
);

router.get("/", getCourses);

router.get(
  "/creator/me",
  authenticate,
  authorize(roles.CREATOR, roles.ADMIN),
  getMyCourses,
);

router.get("/:id", getCourseById);


router.patch(
  "/:id",
  customRateLimit(1, 10),
  authenticate,
  authorize(roles.CREATOR, roles.ADMIN),
  updateCourse,
);

router.delete(
  "/:id",
  customRateLimit(1, 5),
  authenticate,
  authorize(roles.CREATOR, roles.ADMIN),
  deleteCourse,
);

export default router;
