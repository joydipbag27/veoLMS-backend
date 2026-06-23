import express from "express";
import { authenticate } from "../middlewares/authenticate.js";
import {
  forgotPassword,
  setNewPass,
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

router.post("/forgotPassword", customRateLimit(1, 3), forgotPassword);

router.get(
  "/",
  customRateLimit(1, 20),
  authenticate,
  CheckUserName,
);

router.post("/logout", authenticate, Logout);

router.post("/logoutall", authenticate, LogoutAllDevices);

router.patch(
  "/changePassword",
  customRateLimit(1, 3),
  authenticate,
  changePass,
);

router.patch(
  "/setPassword",
  customRateLimit(1, 3),
  authenticate,
  setNewPass,
);

export default router;
