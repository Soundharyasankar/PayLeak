export function sendSuccess(response, data, status = 200) {
  return response.status(status).json({ success: true, data });
}
