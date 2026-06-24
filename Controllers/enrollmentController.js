import Course from "../Models/courseModel.js";
import Enrollment from "../Models/enrollmentModel.js";
import { successResponse, errorResponse } from "../utils/response.js";

// ENROLL IN COURSE
export const enrollInCourse = async (req, res) => {
  try {
    const { id: courseId } = req.params;
    const userId = req.user._id;

    const course = await Course.findById(courseId);
    if (!course) return errorResponse(res, 404, "Course not found");

    if (course.status === "Draft") {
      return errorResponse(res, 400, "Cannot enroll in a draft course");
    }

    if (course.creator.toString() === userId.toString()) {
      return errorResponse(res, 400, "Course creators cannot enroll in their own courses");
    }

    const existingEnrollment = await Enrollment.findOne({ user: userId, course: courseId });
    if (existingEnrollment) {
      return errorResponse(res, 409, "You are already enrolled in this course");
    }

    const enrollment = await Enrollment.create({ user: userId, course: courseId });
    return successResponse(res, 201, "Successfully enrolled in the course", { enrollment });
  } catch (err) {
    console.error("[enrollInCourse] Unexpected error:", err);
    return errorResponse(res, 500, "Failed to enroll in course");
  }
};

// GET MY ENROLLMENTS
export const getMyEnrollments = async (req, res) => {
  try {
    const userId = req.user._id;
    const enrollments = await Enrollment.find({ user: userId })
      .populate({
        path: "course",
        populate: {
          path: "creator",
          select: "username email",
        },
      });
    return successResponse(res, 200, "Successfully fetched enrollments", { enrollments });
  } catch (err) {
    console.error("[getMyEnrollments] Unexpected error:", err);
    return errorResponse(res, 500, "Failed to fetch enrollments");
  }
};

// GET ENROLLMENT BY COURSE ID
export const getEnrollmentByCourseId = async (req, res) => {
  try {
    const { id: courseId } = req.params;
    const userId = req.user._id;

    const enrollment = await Enrollment.findOne({ user: userId, course: courseId })
      .populate({
        path: "course",
        populate: {
          path: "creator",
          select: "username email",
        },
      });

    if (!enrollment) {
      return errorResponse(res, 404, "Enrollment not found for this course");
    }

    return successResponse(res, 200, "Successfully fetched enrollment", { enrollment });
  } catch (err) {
    console.error("[getEnrollmentByCourseId] Unexpected error:", err);
    return errorResponse(res, 500, "Failed to fetch enrollment");
  }
};

