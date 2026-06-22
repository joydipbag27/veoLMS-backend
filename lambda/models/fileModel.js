import { model, Schema } from "mongoose";

const FileSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    extension: {
      type: String,
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    parentDirId: {
      type: Schema.Types.ObjectId,
      ref: "Directory",
    },
    fileSize: {
      type: Schema.Types.Int32,
      default: 0,
    },
    isUploading: {
      type: Boolean,
      default: true,
    },
    favorite: {
      type: Boolean,
      default: false,
    },
    isTrashed: {
      type: Boolean,
      default: false,
    },
    trashedAt: {
      type: Date,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    fileType: {
      type: String,
      enum: ["image", "video", "audio", "document", "other"],
      require: true,
      index: true,
    },
    mimeType: {
      type: String,
      trim: true,
    },
    thumbnailStatus: {
      type: String,
      enum: ["pending", "done"],
      default: "pending",
    },
    thumbnailUrl: {
      type: String,
    },
    lastAccessedAt: {
      type: Date,
    },
  },
  {
    strict: "throw",
    timestamps: true,
  },
);

// Indexes for efficient sorting
// for date sorting
FileSchema.index({ parentDirId: 1, userId: 1, _id: -1 });
// for name sorting
FileSchema.index({ parentDirId: 1, userId: 1, name: 1, _id: 1 });
// for size sorting
FileSchema.index({ parentDirId: 1, userId: 1, fileSize: 1, _id: 1 });

FileSchema.index({
  userId: 1,
  isUploading: 1,
  isTrashed: 1,
  _id: -1,
});

FileSchema.index({
  userId: 1,
  isUploading: 1,
  isTrashed: 1,
  name: 1,
  _id: 1,
});

FileSchema.index({ userId: 1, isTrashed: 1, fileType: 1 });
FileSchema.index({ userId: 1, directoryId: 1 });
FileSchema.index({ createdAt: -1 });
FileSchema.index({ name: "text" });
FileSchema.index({ userId: 1, lastAccessedAt: -1 });

const File = model("File", FileSchema);
export default File;
