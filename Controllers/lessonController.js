import Lesson from "../Models/lessonModel.js";
import Section from "../Models/sectionModel.js";
import Course from "../Models/courseModel.js";
import { createLessonSchema, updateLessonSchema } from "../validators/lessonSchema.js";

// CREATE LESSON
export const createLesson = async (req, res, next) => {
  const { success, data, error } = createLessonSchema.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ error: error.issues[0].message });
  }

  const { title, description, course, section, video, duration, isPreview, order } = data;

  try {
    const courseExists = await Course.findById(course);
    if (!courseExists) {
      return res.status(404).json({ error: "Course not found" });
    }

    const sectionExists = await Section.findById(section);
    if (!sectionExists) {
      return res.status(404).json({ error: "Section not found" });
    }

    // Verify section belongs to the specified course
    if (sectionExists.course.toString() !== course) {
      return res.status(400).json({ error: "Section does not belong to the specified course" });
    }

    // Check if user is either ADMIN or the creator of the course
    if (req.user.role !== "ADMIN" && courseExists.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "You do not have permission to modify this course" });
    }

    const newLesson = await Lesson.create({
      title,
      description,
      course,
      section,
      video,
      duration,
      isPreview,
      order,
    });

    return res.status(201).json({
      message: "Lesson created successfully",
      lesson: newLesson,
    });
  } catch (err) {
    next(err);
  }
};

// GET LESSONS BY SECTION
export const getLessonsBySection = async (req, res, next) => {
  try {
    const { sectionId } = req.params;
    const lessons = await Lesson.find({ section: sectionId }).sort({ order: 1 });
    return res.status(200).json({ lessons });
  } catch (err) {
    next(err);
  }
};

// GET LESSON BY ID
export const getLessonById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const lesson = await Lesson.findById(id);
    if (!lesson) {
      return res.status(404).json({ error: "Lesson not found" });
    }
    return res.status(200).json({ lesson });
  } catch (err) {
    next(err);
  }
};

// UPDATE LESSON
export const updateLesson = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { success, data, error } = updateLessonSchema.safeParse(req.body);
    if (!success) {
      return res.status(400).json({ error: error.issues[0].message });
    }

    const lesson = await Lesson.findById(id);
    if (!lesson) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    const course = await Course.findById(lesson.course);
    if (!course) {
      return res.status(404).json({ error: "Associated course not found" });
    }

    // Check if user is either ADMIN or the creator of the course
    if (req.user.role !== "ADMIN" && course.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "You do not have permission to modify this lesson" });
    }

    Object.assign(lesson, data);
    const updatedLesson = await lesson.save();

    return res.status(200).json({
      message: "Lesson updated successfully",
      lesson: updatedLesson,
    });
  } catch (err) {
    next(err);
  }
};

// DELETE LESSON
export const deleteLesson = async (req, res, next) => {
  try {
    const { id } = req.params;
    const lesson = await Lesson.findById(id);
    if (!lesson) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    const course = await Course.findById(lesson.course);
    if (!course) {
      return res.status(404).json({ error: "Associated course not found" });
    }

    // Check if user is either ADMIN or the creator of the course
    if (req.user.role !== "ADMIN" && course.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "You do not have permission to delete this lesson" });
    }

    await lesson.deleteOne();

    return res.status(200).json({
      message: "Lesson deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};

// GET CREATOR'S OWN LESSONS BY SECTION
export const getMyLessonsBySection = async (req, res, next) => {
  try {
    const { sectionId } = req.params;
    const section = await Section.findById(sectionId);
    if (!section) {
      return res.status(404).json({ error: "Section not found" });
    }

    const course = await Course.findById(section.course);
    if (!course) {
      return res.status(404).json({ error: "Associated course not found" });
    }

    // Check if user is creator of the course or ADMIN
    if (req.user.role !== "ADMIN" && course.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "You do not have permission to view lessons for this section" });
    }

    const lessons = await Lesson.find({ section: sectionId }).sort({ order: 1 });
    return res.status(200).json({ lessons });
  } catch (err) {
    next(err);
  }
};

// GET CREATOR'S OWN LESSON BY ID
export const getMyLessonById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const lesson = await Lesson.findById(id);
    if (!lesson) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    const course = await Course.findById(lesson.course);
    if (!course) {
      return res.status(404).json({ error: "Associated course not found" });
    }

    // Check if user is creator of the course or ADMIN
    if (req.user.role !== "ADMIN" && course.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "You do not have permission to view this lesson" });
    }

    return res.status(200).json({ lesson });
  } catch (err) {
    next(err);
  }
};

