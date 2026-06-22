import mongoose, { model, Schema } from "mongoose";
import mongooseLong from "mongoose-long";

mongooseLong(mongoose);

const directorySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    parentDirId: {
      type: Schema.Types.ObjectId,
      default: null,
      ref: "Directory",
    },
    directorySize: {
      type: Number,
      required: true,
      default: 0,
    },
    path: {
      type: [
        {
          type: Schema.Types.ObjectId,
          ref: "Directory",
        },
      ],
      default: [],
      required: true,
    },
    fileCount: {
      type: mongoose.Schema.Types.Int32,
      default: 0,
      required: true,
    },
    folderCount: {
      type: mongoose.Schema.Types.Int32,
      default: 0,
      required: true,
    },
  },
  {
    strict: "throw",
    timestamps: true,
  },
);

directorySchema.index({ name: "text" });

const Directory = model("Directory", directorySchema);
export default Directory;
