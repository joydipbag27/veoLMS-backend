import { S3Client } from "@aws-sdk/client-s3";

export const thumbnailClient = new S3Client({
  region: process.env.S3_THUMBNAIL_REGION,
  credentials: {
    accessKeyId: process.env.S3_THUMBNAIL_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_THUMBNAIL_SECRET,
  },
});