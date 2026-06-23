import Course from "../Models/courseModel.js";
import Section from "../Models/sectionModel.js";
import Lesson from "../Models/lessonModel.js";
import { createCourseSchema, updateCourseSchema } from "../validators/courseSchema.js";

// CREATE COURSE
export const createCourse = async (req, res, next) => {
  const { success, data, error } = createCourseSchema.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ error: error.issues[0].message });
  }

  const { title, description, thumbnail, price, category, level, status } = data;

  try {
    const newCourse = await Course.create({
      title,
      description,
      thumbnail,
      creator: req.user._id,
      price,
      category,
      level,
      status,
    });

    return res.status(201).json({
      message: "Course created successfully",
      course: newCourse,
    });
  } catch (err) {
    next(err);
  }
};

// GET ALL COURSES (with pagination)
export const getCourses = async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const cursor = req.query.cursor;
    const category = req.query.category;
    const level = req.query.level;
    const status = req.query.status || "Published";

    const query = { status };
    if (category) query.category = category;
    if (level) query.level = level;

    if (cursor) {
      query._id = { $lt: cursor };
    }

    const courses = await Course.find(query)
      .sort({ _id: -1 })
      .limit(limit + 1);

    const hasNextPage = courses.length > limit;
    const data = hasNextPage ? courses.slice(0, limit) : courses;
    const nextCursor = hasNextPage ? data[data.length - 1]._id : null;

    return res.status(200).json({
      courses: data,
      nextCursor,
      hasNextPage,
    });
  } catch (err) {
    next(err);
  }
};

// GET CREATOR'S OWN COURSES
export const getMyCourses = async (req, res, next) => {
  try {
    const creatorId = req.user._id;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const cursor = req.query.cursor;

    const query = { creator: creatorId };

    if (req.query.status) {
      query.status = req.query.status;
    }

    if (cursor) {
      query._id = { $lt: cursor };
    }

    const courses = await Course.find(query)
      .sort({ _id: -1 })
      .limit(limit + 1);

    const hasNextPage = courses.length > limit;
    const data = hasNextPage ? courses.slice(0, limit) : courses;
    const nextCursor = hasNextPage ? data[data.length - 1]._id : null;

    return res.status(200).json({
      courses: data,
      nextCursor,
      hasNextPage,
    });
  } catch (err) {
    next(err);
  }
};


// GET COURSE BY ID
export const getCourseById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const course = await Course.findById(id).populate("creator", "username email");
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }
    return res.status(200).json({ course });
  } catch (err) {
    next(err);
  }
};

// UPDATE COURSE
export const updateCourse = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { success, data, error } = updateCourseSchema.safeParse(req.body);
    if (!success) {
      return res.status(400).json({ error: error.issues[0].message });
    }

    const course = await Course.findById(id);
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    // Check permissions: requesting user must be creator or ADMIN
    if (req.user.role !== "ADMIN" && course.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "You do not have permission to update this course" });
    }

    Object.assign(course, data);
    const updatedCourse = await course.save();

    return res.status(200).json({
      message: "Course updated successfully",
      course: updatedCourse,
    });
  } catch (err) {
    next(err);
  }
};

// DELETE COURSE (Cascading delete)
export const deleteCourse = async (req, res, next) => {
  try {
    const { id } = req.params;
    const course = await Course.findById(id);
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    // Check permissions: requesting user must be creator or ADMIN
    if (req.user.role !== "ADMIN" && course.creator.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "You do not have permission to delete this course" });
    }

    // Delete all lessons of this course
    await Lesson.deleteMany({ course: id });
    // Delete all sections of this course
    await Section.deleteMany({ course: id });
    // Delete course
    await course.deleteOne();

    return res.status(200).json({
      message: "Course and all associated sections and lessons deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};
