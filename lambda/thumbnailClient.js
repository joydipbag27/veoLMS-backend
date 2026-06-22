import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

export const thumbnailClient = new S3Client({
  region: process.env.S3_THUMBNAIL_REGION,
  credentials: {
    accessKeyId: process.env.S3_THUMBNAIL_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_THUMBNAIL_SECRET,
  },
});

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