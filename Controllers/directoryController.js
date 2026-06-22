import Directory from "../Models/directoryModel.js";
import File from "../Models/fileModel.js";
import Share from "../Models/shareModel.js";
import mongoose from "mongoose";
import { dirAndFileNameSchema, sortSchema } from "../validators/authSchema.js";
import { redisClient } from "../config/redis.js";
import { permanentlyDeleteMultipleFromB2 } from "../config/s3Client.js";
import { deleteThumbnail } from "../services/thumbnailService.js";
import { handleCursorPagination } from "../utils/pagination.js";
import {
  directoryCursorConfig,
  fileCursorConfig,
} from "../utils/cursorConfig.js";
import { directorySortMap, fileSortMap } from "../utils/sortMap.js";


//GET FOLDERS ACCORDING TO DIRECTORY
export const GetDirectoryById = async (req, res, next) => {
  try {
    const userOid = req.user.rootDirId.toString();
    const id = req.params.id || userOid;
    const { cursor } = req.query;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid directory id" });
    }

    if (cursor && !mongoose.isValidObjectId(cursor)) {
      return res.status(400).json({ error: "Invalid cursor" });
    }

    const parsedSort = sortSchema.safeParse(req.query.sort);

    const sort = parsedSort.success ? parsedSort.data : "date_desc";

    const directoryData = await Directory.findOne({
      _id: id,
      userId: req.user._id,
    })
      .populate({ path: "path", select: "_id name", options: { lean: true } })
      .lean();

    if (!directoryData) {
      return res.status(404).json({ error: "Directory Not Found" });
    }

    const query = {
      parentDirId: id,
      userId: req.user._id,
    };

    const { data, nextCursor, hasMore } = await handleCursorPagination({
      model: Directory,
      query,
      cursor,
      sort,
      limit: 20,
      sortMap: directorySortMap,
      cursorConfig: directoryCursorConfig,
    });

    const populatedData = await Directory.populate(data, {
      path: "path",
      select: "_id name",
      options: { lean: true },
    });

    return res.status(200).json({
      directories: populatedData,
      directoryData: directoryData,
      nextCursor,
      hasMore,
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};

//GET FILES ACCORDING TO DIRECTORY
export const getDirectoryFiles = async (req, res, next) => {
  try {
    const userOid = req.user.rootDirId.toString();
    const id = req.params.id || userOid;
    const { cursor } = req.query;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid directory id" });
    }

    if (cursor && !mongoose.isValidObjectId(cursor)) {
      return res.status(400).json({ error: "Invalid cursor" });
    }

    const parsedSort = sortSchema.safeParse(req.query.sort);

    const sort = parsedSort.success ? parsedSort.data : "date_desc";

    const exists = await Directory.exists({
      _id: id,
      userId: req.user._id,
    });

    if (!exists) {
      return res.status(404).json({ error: "Directory Not Found" });
    }

    const query = {
      parentDirId: id,
      userId: req.user._id,
      isTrashed: false,
    };

    const { data, nextCursor, hasMore } = await handleCursorPagination({
      model: File,
      query,
      cursor,
      sort,
      limit: 20,
      sortMap: fileSortMap,
      cursorConfig: fileCursorConfig,
    });

    return res.status(200).json({
      files: data,
      nextCursor,
      hasMore,
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};

//DIRECTORY CREATION
export const CreateDirectory = async (req, res, next) => {
  const dirname = req.body.dirname || "New Folder";

  const { success, data, error } = dirAndFileNameSchema.safeParse(dirname);

  if (!success) {
    return res.status(400).json({ error: error.issues[0].message });
  }

  const parentDirId = req.params.parentDirId || req.user.rootDirId;

  if (!mongoose.isValidObjectId(parentDirId)) {
    return res.status(400).json({ error: "Invalid directory id" });
  }

  try {
    const parentDir = await Directory.findOne({
      _id: parentDirId,
      userId: req.user._id,
    }).lean();

    if (!parentDir) {
      return res
        .status(404)
        .json({ message: "Parent Directory Does Not Exist" });
    }

    await Directory.create({
      name: data,
      parentDirId,
      userId: req.user._id,
      path: [...parentDir.path, parentDirId],
      directorySize: 0,
      fileCount: 0,
      folderCount: 0,
    });

    await Directory.findOneAndUpdate(
      {
        _id: parentDirId,
        userId: req.user._id,
      },
      { $inc: { folderCount: 1 } },
    );

    res.status(200).json({ message: "Folder Created" });
  } catch (error) {
    console.log(error);
    next(error);
  }
};

//DIRECTORY RENAME
export const RenameDirectory = async (req, res, next) => {
  const { id } = req.params;
  const { renameValue } = req.body;

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: "Invalid directory id" });
  }

  const { success, data, error } = dirAndFileNameSchema.safeParse(renameValue);

  if (!success) {
    return res.status(400).json({ error: error.issues[0].message });
  }

  try {
    const result = await Directory.updateOne(
      { _id: id, userId: req.user._id },
      { $set: { name: data } },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Directory not found" });
    }

    return res.status(200).json({ message: "Folder Renamed Successfully" });
  } catch (error) {
    next(error);
  }
};

//DIRECTORY DELETE
export const DeleteDirectory = async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: "Invalid directory id" });
  }

  const rootDir = await Directory.findOne({
    _id: id,
    userId: req.user._id,
  }).lean();

  if (!rootDir) {
    return res.status(404).json({ message: "Directory Not Found" });
  }

  if (!rootDir.parentDirId) {
    return res.status(400).json({
      error: "Root directory cannot be deleted",
    });
  }

  //FINDING CHILDRENS AND ADDING ROOTID INTO HAVETODELETEDIR
  const dirs = await Directory.find({
    userId: req.user._id,
    $or: [{ _id: rootDir._id }, { path: rootDir._id }],
  })
    .select("_id")
    .lean();
  const haveToDeleteDir = dirs.map((elem) => elem._id);

  const files = await File.find({
    parentDirId: { $in: haveToDeleteDir },
  })
    .select("_id extension fileType")
    .lean();

  const haveToDeleteFiles = files.map((elem) => elem._id);
  const haveToDeleteFilesFullNames = files.map(
    (elem) => `${elem._id.toString()}${elem.extension}`,
  );

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    if (
      rootDir.path &&
      rootDir.path.length > 0 &&
      (rootDir.directorySize > 0 || rootDir.fileCount > 0)
    ) {
      const incUpdate = {};

      if (rootDir.directorySize > 0) {
        incUpdate.directorySize = -rootDir.directorySize;
      }
      if (rootDir.fileCount > 0) {
        incUpdate.fileCount = -Math.floor(rootDir.fileCount);
      }
      if (Object.keys(incUpdate).length > 0) {
        //DIRECTORY SIZE DECREMENT
        await Directory.updateMany(
          {
            userId: req.user._id,
            _id: { $in: rootDir.path },
          },
          {
            $inc: incUpdate,
          },
          { session },
        );
      }
    }

    //FOLDERCOUNT DECREMENT
    await Directory.findOneAndUpdate(
      {
        _id: rootDir.parentDirId,
        userId: req.user._id,
      },
      { $inc: { folderCount: -1 } },
      { session },
    );

    //DB CLEANING
    if (haveToDeleteDir.length > 0) {
      await Directory.deleteMany(
        { _id: { $in: haveToDeleteDir } },
        { session },
      );
    }
    if (haveToDeleteFiles.length > 0) {
      await File.deleteMany({ _id: { $in: haveToDeleteFiles } }, { session });
    }

    await session.commitTransaction();
    session.endSession();

    const imageFiles = files.filter((file) => file.fileType === "image" || file.fileType === "video");
    if (imageFiles.length > 0) {
      await Promise.all(
        imageFiles.map((file) =>
          deleteThumbnail(
            file._id.toString(),
            req.user._id.toString(),
            file.extension,
          ),
        ),
      );
    }

    // FILESYSTEM CLEANUP (OUTSIDE TRANSACTION)
    if (haveToDeleteFilesFullNames.length > 0) {
      await permanentlyDeleteMultipleFromB2(haveToDeleteFilesFullNames);
    }

    //DELETING SHARE DATA IF AVAILABLE
    await Share.deleteMany({
      ownerId: req.user._id,
      fileId: { $in: haveToDeleteFiles },
    });

    //CACHE INVALIDATION
    await redisClient.del(`profile:${req.user._id}`);
    await redisClient.del(`insight:${req.user._id}`);

    const keys = haveToDeleteDir.map(
      (id) => `folderInsight:${req.user._id}:${id}`,
    );
    keys.push(`insight:${req.user._id}`);
    await redisClient.del(keys);

    return res
      .status(200)
      .json({ message: "The folder and all its contents have been deleted." });
  } catch (error) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    next(error);
  }
};

//GET ALL FOLDERS METADATA
export const getAllFolders = async (req, res) => {
  const directoryData = await Directory.find({
    userId: req.user._id,
  });

  if (!directoryData) {
    return res.status(404).json({ error: "Directory Not Found" });
  }

  res.status(200).json(directoryData);
};
