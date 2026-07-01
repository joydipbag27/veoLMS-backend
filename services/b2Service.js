import {
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { awsS3Client } from "../config/awsS3Client.js";
import { s3Client } from "../config/s3Client.js";

// ─────────────────────────────────────────────
// Configuration constants
// ─────────────────────────────────────────────

/** Maximum simultaneous S3→B2 transfers. */
const CONCURRENCY = 5;

/** Maximum retries per object before giving up. */
const MAX_RETRIES = 3;

/** Max single-object size we will buffer in memory (50 MB safety guard). */
const MAX_BUFFER_BYTES = 50 * 1024 * 1024;

/** Base delay in ms for exponential backoff: 500ms, 2s, 8s. */
const RETRY_BASE_DELAY_MS = 500;

// ─────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn` on every item in `items` with at most `concurrency` Promises
 * active at any one time. Resolves when all items have been processed.
 *
 * @template T, R
 * @param {number} concurrency
 * @param {T[]} items
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
const asyncPool = async (concurrency, items, fn) => {
  const results = [];
  const executing = new Set();

  for (const item of items) {
    const promise = fn(item).then((result) => {
      executing.delete(promise);
      return result;
    });

    executing.add(promise);
    results.push(promise);

    if (executing.size >= concurrency) {
      // Wait for the fastest in-flight promise to settle before launching another.
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
};

/**
 * Reads an entire Node.js Readable stream into a single Buffer.
 * Throws if the stream exceeds MAX_BUFFER_BYTES.
 *
 * @param {import("stream").Readable} stream
 * @param {string} key - Object key (used in error messages only)
 * @returns {Promise<Buffer>}
 */
const streamToBuffer = (stream, key) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    stream.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BUFFER_BYTES) {
        stream.destroy();
        reject(
          new Error(
            `[b2Service] Object ${key} exceeds the ${MAX_BUFFER_BYTES / 1024 / 1024} MB buffer limit.`
          )
        );
        return;
      }
      chunks.push(chunk);
    });

    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });

// ─────────────────────────────────────────────
// Core transfer with per-object retry
// ─────────────────────────────────────────────

/**
 * Copies a single object from AWS S3 to Backblaze B2 with retry logic.
 * Uses a buffer instead of a raw stream to avoid S3→B2 stream-timeout failures.
 *
 * Retry schedule (exponential backoff):
 *   attempt 1 → wait 500ms → attempt 2 → wait 2000ms → attempt 3 → throw
 *
 * @param {string} key          - S3 object key (same key is used for B2)
 * @param {string} s3Bucket     - Source AWS S3 bucket name
 * @param {string} b2Bucket     - Destination Backblaze B2 bucket name
 * @param {number} [maxRetries] - How many attempts total (default: MAX_RETRIES)
 * @returns {Promise<string>}   - The key on success
 */
const copyObjectWithRetry = async (
  key,
  s3Bucket,
  b2Bucket,
  maxRetries = MAX_RETRIES
) => {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 1. Fetch the object from S3
      const s3Object = await awsS3Client.send(
        new GetObjectCommand({ Bucket: s3Bucket, Key: key })
      );

      const contentType = s3Object.ContentType ?? "application/octet-stream";

      // 2. Buffer the entire stream so B2 gets a stable byte source with
      //    an exact ContentLength (B2 rejects transfers without it).
      const buffer = await streamToBuffer(s3Object.Body, key);

      // 3. Upload to B2
      await s3Client.send(
        new PutObjectCommand({
          Bucket: b2Bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          ContentLength: buffer.length,
        })
      );

      console.log(
        `[b2Service] Copied (attempt ${attempt}/${maxRetries}): ${key} (${buffer.length} bytes)`
      );
      return key;
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === maxRetries;

      if (isLastAttempt) {
        console.error(
          `[b2Service] All ${maxRetries} attempts failed for key: ${key}. Last error:`,
          err.message
        );
      } else {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(4, attempt - 1);
        console.warn(
          `[b2Service] Attempt ${attempt}/${maxRetries} failed for key: ${key}. Retrying in ${delay}ms. Error: ${err.message}`
        );
        await sleep(delay);
      }
    }
  }

  throw new Error(
    `[b2Service] Failed to copy "${key}" after ${maxRetries} attempts: ${lastError?.message}`
  );
};

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/**
 * Copies the entire HLS output directory for a given mediaId from the
 * MediaConvert AWS S3 output bucket to Backblaze B2.
 *
 * Strategy:
 *   1. Collect ALL keys via paginated listing BEFORE transferring anything.
 *   2. Transfer with bounded concurrency (CONCURRENCY simultaneous uploads).
 *   3. Each transfer is independently retried up to MAX_RETRIES times.
 *   4. Only returns successfully if every single key was copied.
 *
 * @param {string} mediaId
 * @returns {Promise<string[]>} Ordered list of all successfully copied keys
 * @throws If any object fails after all retries
 */
export const copyHlsFromS3ToB2 = async (mediaId) => {
  if (!mediaId) {
    throw new Error("[b2Service] mediaId is required for copyHlsFromS3ToB2");
  }

  const prefix = `videos/${mediaId}/`;
  const s3Bucket = process.env.MEDIACONVERT_OUTPUT_BUCKET;
  const b2Bucket = process.env.BUCKET_NAME;

  // ── Step 1: Pre-flight listing ──────────────────────────────────────────
  // Collect all keys first. If listing itself fails, we throw before
  // touching any data, keeping the system in a clean state.
  console.log(
    `[b2Service] Listing all objects under s3://${s3Bucket}/${prefix}`
  );

  const allKeys = [];
  let continuationToken = undefined;

  do {
    const listResponse = await awsS3Client.send(
      new ListObjectsV2Command({
        Bucket: s3Bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    if (listResponse.Contents) {
      for (const obj of listResponse.Contents) {
        allKeys.push(obj.Key);
      }
    }

    continuationToken = listResponse.IsTruncated
      ? listResponse.NextContinuationToken
      : undefined;
  } while (continuationToken);

  if (allKeys.length === 0) {
    throw new Error(
      `[b2Service] No objects found in S3 under prefix "${prefix}". MediaConvert output may be missing.`
    );
  }

  console.log(
    `[b2Service] Found ${allKeys.length} objects to copy for mediaId: ${mediaId}`
  );

  // ── Step 2: Bounded-concurrency transfer with per-object retry ───────────
  const keysCopied = await asyncPool(
    CONCURRENCY,
    allKeys,
    (key) => copyObjectWithRetry(key, s3Bucket, b2Bucket)
  );

  // ── Step 3: Validate completeness ───────────────────────────────────────
  // asyncPool + copyObjectWithRetry will throw if any object ultimately
  // fails, so reaching here guarantees all keys were copied.
  if (keysCopied.length !== allKeys.length) {
    throw new Error(
      `[b2Service] Copy incomplete: expected ${allKeys.length} objects, only ${keysCopied.length} succeeded.`
    );
  }

  console.log(
    `[b2Service] All ${keysCopied.length} objects successfully copied to B2 for mediaId: ${mediaId}`
  );

  return keysCopied;
};

/**
 * Deletes the original input video from the MediaConvert input bucket and
 * all generated HLS output objects from the MediaConvert output bucket.
 *
 * Both operations are best-effort: errors are logged but never rethrown.
 * Batch deletion is chunked to stay within the 1,000-key API limit.
 *
 * @param {string}   mediaId    - The media ID (= input object key)
 * @param {string[]} outputKeys - All keys that were in the output bucket
 * @returns {Promise<void>}
 */
export const deleteS3Assets = async (mediaId, outputKeys) => {
  const inputBucket = process.env.MEDIACONVERT_INPUT_BUCKET;
  const outputBucket = process.env.MEDIACONVERT_OUTPUT_BUCKET;

  // ── 1. Delete the original input video ──────────────────────────────────
  try {
    await awsS3Client.send(
      new DeleteObjectCommand({ Bucket: inputBucket, Key: mediaId })
    );
    console.log(
      `[b2Service] Deleted input object: s3://${inputBucket}/${mediaId}`
    );
  } catch (err) {
    console.error(
      `[b2Service] Failed to delete input object ${mediaId} from ${inputBucket}:`,
      err.message
    );
  }

  // ── 2. Delete output objects in chunks of 1,000 ─────────────────────────
  if (!outputKeys || outputKeys.length === 0) return;

  const CHUNK_SIZE = 1000;
  for (let i = 0; i < outputKeys.length; i += CHUNK_SIZE) {
    const chunk = outputKeys.slice(i, i + CHUNK_SIZE);

    try {
      await awsS3Client.send(
        new DeleteObjectsCommand({
          Bucket: outputBucket,
          Delete: {
            Objects: chunk.map((key) => ({ Key: key })),
            Quiet: true,
          },
        })
      );
      console.log(
        `[b2Service] Deleted output chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${chunk.length} objects from s3://${outputBucket}/`
      );
    } catch (err) {
      console.error(
        `[b2Service] Failed to delete output chunk starting at index ${i}:`,
        err.message
      );
    }
  }
};
