import * as z from "zod/v4";

export const loginSchema = z.object({
  email: z.string().trim().pipe(z.email("Please enter a valid email")),
  password: z.string().trim().min(8, "Password should be atleast 8 characters"),
});

export const registerSchema = z.object({
  email: z.string().trim().pipe(z.email("Please enter a valid email")),
  password: z.string().trim().min(8, "Password should be atleast 8 characters"),
  otp: z
    .string()
    .trim()
    .length(6)
    .regex(/^\d{6}$/, "Enter a valid 6-digit OTP")
    .optional(),
  username: z
    .string()
    .trim()
    .min(3, "Username should be atleast 3 character long")
    .max(100, "Username can't exceed 100 characters")
    .regex(/^[a-zA-Z0-9_.-]+$/, "Invalid username"),
});

export const changePassSchema = z.object({
  newPassword: z
    .string()
    .trim()
    .min(8, "Password should be atleast 8 characters"),
  oldPassword: z
    .string()
    .trim()
    .transform((v) => (v === "" ? undefined : v))
    .optional()
    .refine(
      (val) => !val || val.length >= 8,
      "Password should be atleast 8 characters",
    ),
});

export const sidSchema = z.uuid();

export const sendOtpSchema = z.discriminatedUnion("purpose", [
  // 🔐 AUTH (login / register)
  z.object({
    purpose: z.literal("auth"),
    email: z.string().trim().email("Please enter a valid email"),
  }),

  // 🔐 CHANGE EMAIL / SECURITY
  z.object({
    purpose: z.literal("security"),
    email: z.object({
      oldEmail: z.string().trim().email("Old email is not valid"),

      newEmail: z.string().trim().email("New email is not valid"),
    }),
  }),
]);

export const dirAndFileNameSchema = z
  .string()
  .trim()
  .min(1, "Folder name cannot be empty")
  .max(100, "Folder name too long")
  .regex(/^[^<>:"/\\|?*\x00-\x1F]+$/, "Invalid folder name");

export const roleDataSchema = z.object({
  userId: z.string().regex(/^[a-f\d]{24}$/i),
  changeTo: z.enum(["User", "Admin", "Manager", "Owner"]),
});

export const shareSchema = z.object({
  fileId: z.string().regex(/^[a-f\d]{24}$/i, "Invalid fileId"),
  expiry: z.enum(["1h", "1d", "3d", "1w", "1m"]).optional(),
});

export const shareTokenSchema = z
  .string()
  .length(64, "Invalid token length")
  .regex(/^[a-f0-9]{64}$/, "Invalid token format");

export const contentTypeSchema = z
  .string()
  .trim()
  .min(1, "Content type is required")
  .regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/, "Invalid MIME type");

export const createPutSignedUrlSchema = (maxFileSize) =>
  z.object({
    name: dirAndFileNameSchema.default("untitled"),

    size: z
      .number()
      .int()
      .positive("File size must be greater than 0")
      .max(
        maxFileSize,
        `File size exceeds upload limit of ${Math.floor(
          maxFileSize / (1024 * 1024),
        )}MB`,
      ),

    contentType: contentTypeSchema,
  });

export const verifyChangeEmailSchema = z.object({
  newEmail: z.string().trim().email("Please enter a valid new email"),

  oldEmailOtp: z
    .string()
    .length(6, "Old email OTP must be 6 digits")
    .regex(/^\d+$/, "Old email OTP must be numeric"),

  newEmailOtp: z
    .string()
    .length(6, "New email OTP must be 6 digits")
    .regex(/^\d+$/, "New email OTP must be numeric"),

  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const SelectPlanSchema = z.object({
  planId: z.string().min(1, "Plan ID is required").trim(),

  billingCycle: z.enum(["monthly", "yearly"], {
    errorMap: () => ({ message: "Billing cycle must be monthly or yearly" }),
  }),
});

export const CancelSchema = z.object({ immediate: z.boolean().optional() });

export const UpgradeAndDowngradePlanSchema = z
  .object({
    oldPlanId: z.string().min(1, "Old plan ID is required"),
    newPlanId: z.string().min(1, "New plan ID is required"),
    oldBillingCycle: z.enum(["monthly", "yearly"]),
    newBillingCycle: z.enum(["monthly", "yearly"]),
  })
  .refine((data) => data.oldPlanId !== data.newPlanId, {
    message: "New plan must be different from current plan",
    path: ["newPlanId"],
  });

export const LargeOldFilesQuerySchema = z.object({
  minSizeMB: z
    .string()
    .transform((val) => Number(val))
    .refine((val) => !isNaN(val) && val >= 0, {
      message: "minSizeMB must be a positive number",
    })
    .optional(),

  olderThanDays: z
    .string()
    .transform((val) => Number(val))
    .refine((val) => !isNaN(val) && val >= 0, {
      message: "olderThanDays must be a positive number",
    })
    .optional(),
});

export const searchQuerySchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, "Search query is required")
    .max(100, "Query too long"),

  context: z.enum([
    "all",
    "files",
    "directory",
    "trash",
    "shared",
    "favorites",
  ]),
});

export const sortSchema = z
  .enum([
    "date_desc",
    "date_asc",
    "name_asc",
    "name_desc",
    "size_asc",
    "size_desc",
  ])
  .default("date_desc");
