import express from "express";
import { getSearches } from "../Controllers/searchController.js";
import { customRateLimit } from "../middlewares/rateLimit.js";

const router = express.Router();

router.get("/", customRateLimit(60), getSearches);

export default router;
