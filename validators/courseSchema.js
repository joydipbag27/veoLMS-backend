import * as z from "zod/v4";

export const createCourseSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Title must be at least 3 characters")
    .max(100, "Title cannot exceed 100 characters"),
  description: z
    .string()
    .trim()
    .min(10, "Description must be at least 10 characters"),
  thumbnailUrl: z
    .string()
    .url("Invalid thumbnail URL")
    .optional()
    .or(z.literal("")),
  price: z.coerce
    .number()
    .nonnegative("Price must be a positive number or zero")
    .default(0),
  category: z.string().trim().min(1, "Category is required"),
  level: z.enum(["Beginner", "Intermediate", "Advanced"]).default("Beginner"),
  status: z.enum(["Draft", "Published"]).default("Draft"),
});

export const updateCourseSchema = createCourseSchema.omit({ status: true }).partial();

