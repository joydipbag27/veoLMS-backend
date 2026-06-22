import mongoose, { Schema, model } from "mongoose";

const shareSchema = new Schema(
  {
    ownerId: {
      type: mongoose.Types.ObjectId,
      required: true,
      ref: "User",
    },
    fileId: {
      type: mongoose.Types.ObjectId,
      required: true,
      ref: "File",
    },
    fileType: {
      type: String,
      enum: ["image", "video", "audio", "document", "other"],
      require: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
    },
    sharedWith: {
      type: [String],
      required: true,
      default: [],
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    totalViews: {
      type: Number,
      default: 0,
    },
    totalDownloads: {
      type: Number,
      default: 0,
    },
    lastAccessedAt: {
      type: Date,
    },
    maxDownloads: {
      type: Number,
      default: null,
    },
  },
  {
    strict: "throw",
    timestamps: true,
  },
);

shareSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
shareSchema.index({ ownerId: 1, fileType: 1 });

const Share = model("Share", shareSchema);

export default Share;
