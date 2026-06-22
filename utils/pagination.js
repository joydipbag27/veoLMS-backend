import mongoose from "mongoose";

export const handleCursorPagination = async ({
  model,
  query,
  cursor,
  sort,
  limit,
  sortMap,
  cursorConfig
}) => {
  const finalSort = sortMap[sort] ? sort : "date_desc";
  const config = cursorConfig[finalSort];
  const sortQuery = sortMap[finalSort];

  let parsedCursor = null;

  // 🔹 Parse cursor
  if (cursor) {
    if (config.type === "id") {
      if (!mongoose.isValidObjectId(cursor)) {
        throw new Error("INVALID_CURSOR");
      }
      parsedCursor = cursor;
    } else {
      try {
        parsedCursor = JSON.parse(cursor);

        if (
          !parsedCursor ||
          !mongoose.isValidObjectId(parsedCursor._id) ||
          parsedCursor.value === undefined
        ) {
          throw new Error();
        }
      } catch {
        throw new Error("INVALID_CURSOR_FORMAT");
      }
    }
  }

  // 🔹 Apply cursor to query
  if (parsedCursor) {
    if (config.type === "id") {
      query._id = { [config.operator]: parsedCursor };
    } else {
      query.$or = [
        { [config.field]: { [config.operator]: parsedCursor.value } },
        {
          [config.field]: parsedCursor.value,
          _id: { $gt: parsedCursor._id },
        },
      ];
    }
  }

  // 🔹 Fetch data
  const data = await model.find(query).sort(sortQuery).limit(limit).lean();

  // 🔹 Create next cursor
  let nextCursor = null;

  if (data.length === limit) {
    const last = data[limit - 1];

    if (config.type === "id") {
      nextCursor = last._id;
    } else {
      nextCursor = JSON.stringify({
        value: last[config.field],
        _id: last._id,
      });
    }
  }

  return {
    data,
    nextCursor,
    hasMore: data.length === limit,
  };
};
