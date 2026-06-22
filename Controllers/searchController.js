import { searchQuerySchema } from "../validators/authSchema.js";
import Directory from "../Models/directoryModel.js";
import File from "../Models/fileModel.js";
import Share from "../Models/shareModel.js";

export const getSearches = async (req, res) => {
  try {
    const { query, context } = searchQuerySchema.parse(req.query);

    const userId = req.user._id;
    const LIMIT = 5;

    const searchCondition = {
      $regex: query,
      $options: "i",
    };

    if (context === "all") {
      const [directories, files] = await Promise.all([
        Directory.find({
          userId,
          name: searchCondition,
        }).limit(LIMIT),

        File.find({
          userId,
          name: searchCondition,
          isTrashed: false,
          isUploading: false,
        }).limit(LIMIT),
      ]);

      const parentIds = files
        .map((file) => file.parentDirId)
        .filter((id) => id);
      const uniqueParentIds = [...new Set(parentIds)];

      const fileDirectories = await Directory.find({
        _id: { $in: uniqueParentIds },
        userId,
      });

      const allDirectories = [...directories, ...fileDirectories];
      const uniqueDirectories = [
        ...new Map(
          allDirectories.map((dir) => [dir._id.toString(), dir]),
        ).values(),
      ];

      const finalDirectories = uniqueDirectories.slice(0, LIMIT);
      const isEmpty = finalDirectories.length === 0 && files.length === 0;

      return res
        .status(200)
        .json({ results: { directories: finalDirectories, files }, empty: isEmpty });
    } else if (context === "files") {
      const files = await File.find({
        userId,
        name: searchCondition,
        isTrashed: false,
        isUploading: false,
      }).limit(LIMIT);

      const isEmpty = files.length === 0;

      return res.status(200).json({ results: files, empty: isEmpty });
    } else if (context === "directory") {
      const directories = await Directory.find({
        userId,
        name: searchCondition,
      }).limit(LIMIT);

      const isEmpty = directories.length === 0;

      return res.status(200).json({ results: directories, empty: isEmpty });
    } else if (context === "favorites") {
      const favorites = await File.find({
        userId,
        name: searchCondition,
        isTrashed: false,
        isUploading: false,
        favorite: true,
      }).limit(LIMIT);

      const isEmpty = favorites.length === 0;

      return res.status(200).json({ results: favorites, empty: isEmpty });
    } else if (context === "trash") {
      const items = await File.find({
        userId,
        name: searchCondition,
        isTrashed: true,
        isUploading: false,
      }).limit(LIMIT);

      const isEmpty = items.length === 0;

      return res.status(200).json({ results: items, empty: isEmpty});
    } else if (context === "shared") {
      const sharedFilesMeta = await Share.find({ ownerId: userId }).lean();
      const shareFilesArr = sharedFilesMeta.flatMap((elem) => elem.fileId);

      const sharedFiles = await File.find({
        userId,
        name: searchCondition,
        isTrashed: false,
        isUploading: false,
        _id: { $in: shareFilesArr },
      }).limit(LIMIT);

      const isEmpty = sharedFiles.length === 0;

      return res.status(200).json({ results: sharedFiles, empty: isEmpty });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Search failed" });
  }
};
