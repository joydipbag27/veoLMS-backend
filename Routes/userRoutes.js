import express from "express";
import { checkAuth, checkIfBlocked } from "../middlewares/authMiddleware.js";
import {
  changeEmail,
  changePass,
  CheckUserName,
  Login,
  Logout,
  LogoutAllDevices,
  Register,
} from "../Controllers/userController.js";
import { customRateLimit } from "../middlewares/rateLimit.js";

export const router = express.Router();

router.post("/register", customRateLimit(1, 2), Register);

router.post("/login", customRateLimit(1, 5), Login);

router.get(
  "/",
  customRateLimit(1, 20),
  checkAuth,
  checkIfBlocked,
  CheckUserName,
);

router.post("/logout", checkAuth, Logout);

router.post("/logoutall", checkAuth, LogoutAllDevices);

router.patch(
  "/changePassword",
  customRateLimit(1, 3),
  checkAuth,
  checkIfBlocked,
  changePass,
);

router.patch(
  "/changeEmail",
  customRateLimit(1, 3),
  checkAuth,
  checkIfBlocked,
  changeEmail,
);

export default router;
