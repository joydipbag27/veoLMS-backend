export const fileCursorConfig = {
  date_desc: {
    type: "id",
    operator: "$lt",
  },
  date_asc: {
    type: "id",
    operator: "$gt",
  },

  name_asc: {
    type: "field",
    field: "name",
    operator: "$gt",
  },
  name_desc: {
    type: "field",
    field: "name",
    operator: "$lt",
  },

  size_asc: {
    type: "field",
    field: "fileSize",
    operator: "$gt",
  },
  size_desc: {
    type: "field",
    field: "fileSize",
    operator: "$lt",
  },
};

export const directoryCursorConfig = {
  date_desc: {
    type: "id",
    operator: "$lt",
  },
  date_asc: {
    type: "id",
    operator: "$gt",
  },

  name_asc: {
    type: "field",
    field: "name",
    operator: "$gt",
  },
  name_desc: {
    type: "field",
    field: "name",
    operator: "$lt",
  },

  size_asc: {
    type: "field",
    field: "directorySize",
    operator: "$gt",
  },
  size_desc: {
    type: "field",
    field: "directorySize",
    operator: "$lt",
  },
};
