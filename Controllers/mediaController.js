import { PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client, permanentlyDeleteMultipleFromB2 } from "../config/s3Client.js";
import Media from "../Models/mediaModel.js";
import Course from "../Models/courseModel.js";
import Lesson from "../Models/lessonModel.js";
import { uploadUrlSchema, confirmUploadSchema } from "../validators/mediaSchema.js";
import { successResponse, errorResponse } from "../utils/response.js";

// POST /media/lesson/:lessonId/upload-url
export const getLessonVideoUploadUrl = async (req, res) => {
  const { lessonId } = req.params;
  const { success, data, error } = uploadUrlSchema.safeParse(req.body);
  if (!success) return errorResponse(res, 400, error.issues[0].message);

  try {
    const lesson = await Lesson.findById(lessonId);
    if (!lesson) return errorResponse(res, 404, "Lesson not found");

    if (lesson.video) {
      return errorResponse(res, 400, "Lesson already has a video attached");
    }

    const course = await Course.findById(lesson.course);
    if (!course) return errorResponse(res, 404, "Associated course not found");

    if (req.user.role !== "ADMIN" && course.creator.toString() !== req.user._id.toString()) {
      return errorResponse(res, 403, "You do not have permission to modify this lesson");
    }

    // Create a draft Media document — its _id becomes the B2 key
    const media = await Media.create({
      uploadedBy: req.user._id,
      mimeType: data.mimeType,
      size: 0,
      status: "UPLOADING",
    });

    const key = media._id.toString();

    const command = new PutObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: key,
      ContentType: data.mimeType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return successResponse(res, 200, "Upload URL generated", { uploadUrl, mediaId: key });
  } catch (err) {
    console.error("[getLessonVideoUploadUrl] Failed to generate presigned PUT URL:", err);
    return errorResponse(res, 500, "Failed to generate upload URL");
  }
};

// POST /media/lesson/:lessonId/replace-url
export const getLessonVideoReplaceUrl = async (req, res) => {
  const { lessonId } = req.params;
  const { success, data, error } = uploadUrlSchema.safeParse(req.body);
  if (!success) return errorResponse(res, 400, error.issues[0].message);

  try {
    const lesson = await Lesson.findById(lessonId);
    if (!lesson) return errorResponse(res, 404, "Lesson not found");

    if (!lesson.video) {
      return errorResponse(res, 400, "Lesson does not have a video to replace. Use the upload endpoint instead.");
    }

    const oldMediaId = lesson.video;
    const oldMedia = await Media.findById(oldMediaId);
    if (oldMedia) {
      await permanentlyDeleteMultipleFromB2([oldMediaId.toString()]);
      await oldMedia.deleteOne();
    }
    lesson.video = null;
    await lesson.save();

    const course = await Course.findById(lesson.course);
    if (!course) return errorResponse(res, 404, "Associated course not found");

    if (req.user.role !== "ADMIN" && course.creator.toString() !== req.user._id.toString()) {
      return errorResponse(res, 403, "You do not have permission to modify this lesson");
    }

    // Create a draft Media document — its _id becomes the B2 key
    const media = await Media.create({
      uploadedBy: req.user._id,
      mimeType: data.mimeType,
      size: 0,
      status: "UPLOADING",
    });

    const key = media._id.toString();

    const command = new PutObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: key,
      ContentType: data.mimeType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return successResponse(res, 200, "Replace URL generated", { uploadUrl, mediaId: key });
  } catch (err) {
    console.error("[getLessonVideoReplaceUrl] Failed to generate presigned PUT URL:", err);
    return errorResponse(res, 500, "Failed to generate replace URL");
  }
};

// POST /media/lesson/:lessonId/confirm
export const confirmLessonVideoUpload = async (req, res) => {
  const { lessonId } = req.params;
  const { success, data, error } = confirmUploadSchema.safeParse(req.body);
  if (!success) return errorResponse(res, 400, error.issues[0].message);

  try {
    const lesson = await Lesson.findById(lessonId);
    if (!lesson) return errorResponse(res, 404, "Lesson not found");

    const course = await Course.findById(lesson.course);
    if (!course) return errorResponse(res, 404, "Associated course not found");

    if (req.user.role !== "ADMIN" && course.creator.toString() !== req.user._id.toString()) {
      return errorResponse(res, 403, "You do not have permission to modify this lesson");
    }

    const media = await Media.findById(data.mediaId);
    if (!media) return errorResponse(res, 404, "Media record not found");

    const key = media._id.toString();

    // Verify file exists on B2 and size matches
    const headCommand = new HeadObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: key,
    });

    let s3Data;
    try {
      s3Data = await s3Client.send(headCommand);
    } catch (err) {
      console.error("[confirmLessonVideoUpload] File lookup failed on B2. Cleaning up:", err);
      await media.deleteOne();
      return errorResponse(res, 400, "File does not exist on storage");
    }

    if (s3Data.ContentLength !== data.size) {
      console.error(`[confirmLessonVideoUpload] File size mismatch: expected ${data.size}, got ${s3Data.ContentLength}`);
      await permanentlyDeleteMultipleFromB2([key]);
      await media.deleteOne();
      return errorResponse(res, 400, "File size mismatch on storage");
    }

    media.mimeType = data.mimeType;
    media.size = data.size;
    media.status = "READY";
    await media.save();

    // Associate media with lesson and clean up old media if exists
    const oldMediaId = lesson.video;
    lesson.video = media._id;
    await lesson.save();

    if (oldMediaId && oldMediaId.toString() !== media._id.toString()) {
      const oldMedia = await Media.findById(oldMediaId);
      if (oldMedia) {
        await permanentlyDeleteMultipleFromB2([oldMediaId.toString()]);
        await oldMedia.deleteOne();
      }
    }

    const updatedLesson = await Lesson.findById(lessonId).populate("video");
    return successResponse(res, 200, "Lesson video upload confirmed and associated successfully", { lesson: updatedLesson, media });
  } catch (err) {
    console.error("[confirmLessonVideoUpload] Unexpected error:", err);
    return errorResponse(res, 500, "Failed to confirm upload");
  }
};

// GET /media/:id/download
export const getMediaDownloadUrl = async (req, res) => {
  const { id } = req.params;
  if (!/^[a-f\d]{24}$/i.test(id)) return errorResponse(res, 400, "Invalid media ID");

  try {
    const media = await Media.findById(id);
    if (!media) return errorResponse(res, 404, "Media not found");

    const command = new GetObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: media._id.toString(),
    });

    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return successResponse(res, 200, "Download URL generated", { downloadUrl });
  } catch (err) {
    console.error("[getMediaDownloadUrl] Failed to generate presigned GET URL:", err);
    return errorResponse(res, 500, "Failed to generate download URL");
  }
};

// DELETE /media/:id
export const deleteMedia = async (req, res) => {
  const { id } = req.params;
  if (!/^[a-f\d]{24}$/i.test(id)) return errorResponse(res, 400, "Invalid media ID");

  try {
    const media = await Media.findById(id);
    if (!media) return errorResponse(res, 404, "Media not found");

    // Only uploader or ADMIN may delete
    if (
      req.user.role !== "ADMIN" &&
      media.uploadedBy.toString() !== req.user._id.toString()
    ) {
      return errorResponse(res, 403, "You do not have permission to delete this media");
    }

    await permanentlyDeleteMultipleFromB2([media._id.toString()]);
    await media.deleteOne();

    return successResponse(res, 200, "Media deleted successfully");
  } catch (err) {
    console.error("[deleteMedia] Unexpected error:", err);
    return errorResponse(res, 500, "Failed to delete media");
  }
};

