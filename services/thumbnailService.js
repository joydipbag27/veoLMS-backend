import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import File from "../Models/fileModel.js";
import { s3Client } from "../config/s3Client.js";
import sharp from "sharp";
import { thumbnailClient } from "../config/thumbnailClient.js";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const generateThumbnail = async (fileId, userId, retryCount = 0) => {
  try {
    const fileInfo = await File.findById(fileId);

    if (!fileInfo) {
      console.warn(`[Thumbnail] File not found: ${fileId}`);
      return;
    }

    if (fileInfo.fileType !== "image") {
      console.log(`[Thumbnail] Not an image file: ${fileId}`);
      return;
    }

    if (fileInfo.thumbnailStatus === "done") {
      console.log(`[Thumbnail] Already generated: ${fileId}`);
      return;
    }

    if (fileInfo.fileSize > 20 * 1024 * 1024) {
      console.log("Skipping large file");
      return;
    }

    const objectKey = `${fileInfo.id}${fileInfo.extension}`;

    // Stream directly from S3 instead of fetching via signed URL
    const getCommand = new GetObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: objectKey,
    });

    let fileStream;
    try {
      const response = await s3Client.send(getCommand);
      fileStream = response.Body;
    } catch (error) {
      console.error(
        `[Thumbnail] Failed to retrieve file from S3: ${fileId}`,
        error.message,
      );

      if (retryCount < MAX_RETRIES) {
        console.log(
          `[Thumbnail] Retrying... (${retryCount + 1}/${MAX_RETRIES})`,
        );
        await sleep(RETRY_DELAY_MS * (retryCount + 1));
        return generateThumbnail(fileId, userId, retryCount + 1);
      }
      return;
    }

    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of fileStream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Generate thumbnail using Sharp
    let thumbnail;
    try {
      thumbnail = await sharp(buffer)
        .resize(200, 200, { fit: "cover", position: "center" })
        .jpeg({ quality: 60, progressive: true })
        .toBuffer();
    } catch (error) {
      console.error(
        `[Thumbnail] Sharp processing failed for ${fileId}:`,
        error.message,
      );

      if (retryCount < MAX_RETRIES) {
        console.log(
          `[Thumbnail] Retrying... (${retryCount + 1}/${MAX_RETRIES})`,
        );
        await sleep(RETRY_DELAY_MS * (retryCount + 1));
        return generateThumbnail(fileId, userId, retryCount + 1);
      }
      return;
    }

    // Upload thumbnail to S3
    const thumbnailKey = `thumbnails/${userId}/${objectKey}`;

    const putCommand = new PutObjectCommand({
      Bucket: process.env.S3_THUMBNAIL_BUCKET,
      Key: thumbnailKey,
      Body: thumbnail,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
    });

    const cdnUrl = `https://cdn.sastadrive.in/thumbnails/${fileInfo.userId}/${objectKey}`;

    try {
      const result = await thumbnailClient.send(putCommand);

      if (result.$metadata.httpStatusCode === 200) {
        await File.findOneAndUpdate(
          { _id: fileId, userId },
          { $set: { thumbnailStatus: "done", thumbnailUrl: cdnUrl } },
        );

        console.log(`[Thumbnail] Successfully generated: ${fileId}`);
      } else {
        throw new Error(
          `Unexpected status code: ${result.$metadata.httpStatusCode}`,
        );
      }
    } catch (error) {
      console.error(
        `[Thumbnail] Failed to upload thumbnail for ${fileId}:`,
        error.message,
      );

      if (retryCount < MAX_RETRIES) {
        console.log(
          `[Thumbnail] Retrying... (${retryCount + 1}/${MAX_RETRIES})`,
        );
        await sleep(RETRY_DELAY_MS * (retryCount + 1));
        return generateThumbnail(fileId, userId, retryCount + 1);
      }
    }
  } catch (error) {
    console.error(`[Thumbnail] Unexpected error for ${fileId}:`, error.message);
  }
};

export const deleteThumbnail = async (fileId, userId, extension) => {
  if (!fileId || !userId || !extension) {
    console.warn("[Thumbnail] Missing parameters for deleteThumbnail");
    return;
  }

  const thumbnailKey = `thumbnails/${userId}/${fileId}${extension}`;

  try {
    await thumbnailClient.send(
      new DeleteObjectCommand({
        Bucket: process.env.S3_THUMBNAIL_BUCKET,
        Key: thumbnailKey,
      }),
    );
    console.log(`[Thumbnail] Deleted thumbnail for ${fileId}`);
  } catch (error) {
    console.error(
      `[Thumbnail] Failed to delete thumbnail for ${fileId}:`,
      error.message,
    );
  }
};
