export const extensionMap = {
  imageExt: [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
    "bmp",
    "tiff",
    "tif",
    "svg",
    "heic",
    "heif",
    "ico",
    "avif",
    "raw",
    "cr2",
    "nef",
    "arw",
  ],
  videoExt: [
    "mp4",
    "mkv",
    "mov",
    "avi",
    "webm",
    "flv",
    "wmv",
    "m4v",
    "3gp",
    "mpeg",
    "mpg",
    "ts",
    "m2ts",
  ],
  audioExt: ["mp3", "wav", "aac", "flac", "ogg", "m4a", "wma"],
  documentExt: [
    "pdf",

    // Word
    "doc",
    "docx",
    "rtf",
    "odt",

    // Excel
    "xls",
    "xlsx",
    "csv",
    "ods",

    // PowerPoint
    "ppt",
    "pptx",
    "odp",

    // Text
    "txt",
    "md",
    "log",

    // eBooks
    "epub",
    "mobi",

    // Code / Dev files (very common in storage apps)
    "json",
    "xml",
    "html",
    "css",
    "js",
    "ts",
  ],
};

export const getFileCategory = (extension) => {
  if (extensionMap.imageExt.includes(extension)) {
    return "image";
  } else if (extensionMap.videoExt.includes(extension)) {
    return "video";
  } else if (extensionMap.audioExt.includes(extension)) {
    return "audio";
  } else if (extensionMap.documentExt.includes(extension)) {
    return "document";
  } else {
    return "other";
  }
};
