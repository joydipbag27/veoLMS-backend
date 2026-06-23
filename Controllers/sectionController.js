import Section from "../Models/sectionModel.js";
import Course from "../Models/courseModel.js";
import Lesson from "../Models/lessonModel.js";
import { createSectionSchema, updateSectionSchema } from "../validators/sectionSchema.js";

// CREATE SECTION
export const createSection = async (req, res, next) => {
  const { success, data, error } = createSectionSchema.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ error: error.issues[0].message });
  }

  const { title, description, course, order } = data;

  try {
    const courseExists = await Course.findById(course);
    if (!courseExists) {
      return res.status(404).json({ error: "Course not found" });
    }

    // Check if user is either ADMIN or the creator of the course
    if (req.user.role !== "ADMIN" && courseExists.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "You do not have permission to modify this course" });
    }

    const newSection = await Section.create({
      title,
      description,
      course,
      order,
    });

    return res.status(201).json({
      message: "Section created successfully",
      section: newSection,
    });
  } catch (err) {
    next(err);
  }
};

// GET SECTIONS BY COURSE
export const getSectionsByCourse = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const sections = await Section.find({ course: courseId }).sort({ order: 1 });
    return res.status(200).json({ sections });
  } catch (err) {
    next(err);
  }
};

// GET SECTION BY ID
export const getSectionById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const section = await Section.findById(id);
    if (!section) {
      return res.status(404).json({ error: "Section not found" });
    }
    return res.status(200).json({ section });
  } catch (err) {
    next(err);
  }
};

// UPDATE SECTION
export const updateSection = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { success, data, error } = updateSectionSchema.safeParse(req.body);
    if (!success) {
      return res.status(400).json({ error: error.issues[0].message });
    }

    const section = await Section.findById(id);
    if (!section) {
      return res.status(404).json({ error: "Section not found" });
    }

    const course = await Course.findById(section.course);
    if (!course) {
      return res.status(404).json({ error: "Associated course not found" });
    }

    // Check if user is either ADMIN or the creator of the course
    if (req.user.role !== "ADMIN" && course.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "You do not have permission to modify this section" });
    }

    Object.assign(section, data);
    const updatedSection = await section.save();

    return res.status(200).json({
      message: "Section updated successfully",
      section: updatedSection,
    });
  } catch (err) {
    next(err);
  }
};

// DELETE SECTION (Cascading delete)
export const deleteSection = async (req, res, next) => {
  try {
    const { id } = req.params;
    const section = await Section.findById(id);
    if (!section) {
      return res.status(404).json({ error: "Section not found" });
    }

    const course = await Course.findById(section.course);
    if (!course) {
      return res.status(404).json({ error: "Associated course not found" });
    }

    // Check if user is either ADMIN or the creator of the course
    if (req.user.role !== "ADMIN" && course.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "You do not have permission to delete this section" });
    }

    // Cascade delete lessons belonging to this section
    await Lesson.deleteMany({ section: id });
    await section.deleteOne();

    return res.status(200).json({
      message: "Section and all associated lessons deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};

// GET CREATOR'S OWN SECTIONS BY COURSE
export const getMySectionsByCourse = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    // Check if user is creator of the course or ADMIN
    if (req.user.role !== "ADMIN" && course.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "You do not have permission to view sections for this course" });
    }

    const sections = await Section.find({ course: courseId }).sort({ order: 1 });
    return res.status(200).json({ sections });
  } catch (err) {
    next(err);
  }
};

// GET CREATOR'S OWN SECTION BY ID
export const getMySectionById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const section = await Section.findById(id);
    if (!section) {
      return res.status(404).json({ error: "Section not found" });
    }

    const course = await Course.findById(section.course);
    if (!course) {
      return res.status(404).json({ error: "Associated course not found" });
    }

    // Check if user is creator of the course or ADMIN
    if (req.user.role !== "ADMIN" && course.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "You do not have permission to view this section" });
    }

    return res.status(200).json({ section });
  } catch (err) {
    next(err);
  }
};

