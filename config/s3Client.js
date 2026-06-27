import { S3Client, ListObjectVersionsCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";

export const s3Client = new S3Client({
  endpoint: process.env.BLACK_BLAZE_ENDPOINT,
  region: process.env.BLACK_BLAZE_REGION,
  credentials: {
    accessKeyId: process.env.BLACK_BLAZE_ACCESS_KEY_ID,
    secretAccessKey: process.env.BLACK_BLAZE_SECRET,
  },
});

export const permanentlyDeleteMultipleFromB2 = async (keys) => {
  if (!keys || keys.length === 0) return;

  const objectsToDelete = [];

  for (const key of keys) {
    let versionsData = null;
    try {
      versionsData = await s3Client.send(
        new ListObjectVersionsCommand({
          Bucket: process.env.BUCKET_NAME,
          Prefix: key,
        })
      );
    } catch (err) {
      console.error(`Failed to list object versions for key ${key}:`, err);
    }

    let versionsFound = false;

    if (versionsData) {
      if (versionsData.Versions && versionsData.Versions.length > 0) {
        versionsFound = true;
        for (const version of versionsData.Versions) {
          objectsToDelete.push({
            Key: key,
            VersionId: version.VersionId,
          });
        }
      }

      if (versionsData.DeleteMarkers && versionsData.DeleteMarkers.length > 0) {
        versionsFound = true;
        for (const marker of versionsData.DeleteMarkers) {
          objectsToDelete.push({
            Key: key,
            VersionId: marker.VersionId,
          });
        }
      }
    }

    // Fallback: If no versions/markers were listed/returned, queue the key for simple deletion without versionId
    if (!versionsFound) {
      objectsToDelete.push({ Key: key });
    }
  }

  if (objectsToDelete.length === 0) return;

  try {
    await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: process.env.BUCKET_NAME,
        Delete: {
          Objects: objectsToDelete,
          Quiet: true,
        },
      }),
    );
  } catch (err) {
    console.error("Failed to delete objects from B2:", err);
  }
};
