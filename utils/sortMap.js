export const fileSortMap = {
  date_desc: { _id: -1 },
  date_asc: { _id: 1 },

  name_asc: { name: 1, _id: 1 },
  name_desc: { name: -1, _id: 1 },
  
  size_asc: { fileSize: 1, _id: 1 },
  size_desc: { fileSize: -1, _id: 1 },
};

export const directorySortMap = {
  date_desc: { _id: -1 },
  date_asc: { _id: 1 },

  name_asc: { name: 1, _id: 1 },
  name_desc: { name: -1, _id: 1 },

  size_asc: { directorySize: 1, _id: 1 },
  size_desc: { directorySize: -1, _id: 1 },
};