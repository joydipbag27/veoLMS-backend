import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client } from "../config/s3Client.js";
import { successResponse, errorResponse } from "../utils/response.js";

// GET PRE-SIGNED UPLOAD URL
export const getUploadUrl = async (req, res) => {
  const { fileName, contentType } = req.body;
  if (!fileName || !contentType) {
    return errorResponse(res, 400, "fileName and contentType are required");
  }

  try {
    const command = new PutObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: fileName,
      ContentType: contentType,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return successResponse(res, 200, "Upload URL generated", { uploadUrl: url, key: fileName });
  } catch (err) {
    console.error("[getUploadUrl] Failed to generate presigned PUT URL:", err);
    return errorResponse(res, 500, "Failed to generate upload URL");
  }
};

// GET PRE-SIGNED DOWNLOAD URL
export const getDownloadUrl = async (req, res) => {
  const { key } = req.params;
  if (!key) return errorResponse(res, 400, "File key is required");

  try {
    const command = new GetObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: key,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return successResponse(res, 200, "Download URL generated", { downloadUrl: url });
  } catch (err) {
    console.error("[getDownloadUrl] Failed to generate presigned GET URL:", err);
    return errorResponse(res, 500, "Failed to generate download URL");
  }
};
