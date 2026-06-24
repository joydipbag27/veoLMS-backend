/**
 * Send a successful JSON response.
 * @param {import("express").Response} res
 * @param {number} statusCode
 * @param {string} message
 * @param {object|null} data
 */
export const successResponse = (res, statusCode, message, data = null) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

/**
 * Send an error JSON response.
 * @param {import("express").Response} res
 * @param {number} statusCode
 * @param {string} error
 */
export const errorResponse = (res, statusCode, error) => {
  return res.status(statusCode).json({
    success: false,
    error,
  });
};
