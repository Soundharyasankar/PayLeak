import { Router } from "express";
import { requireAuth, getUserId } from "../middleware/authMiddleware.ts";
import { asyncHandler } from "../utils/asyncHandler.js";
import { success } from "../utils/response.ts";
import { deleteNotification, draftReminder, listNotifications, markNotificationRead, sendReminder } from "../services/notificationService.ts";
import { idParam } from "../validators/common.js";
import { z } from "zod";
import { AppError } from "../utils/errors.js";
import { Notification } from "../models/Notification.js";

const readBody = z.object({ read: z.boolean() }).strict();
export const notificationRoutes = Router();
notificationRoutes.use(requireAuth);
notificationRoutes.get("/", asyncHandler(async (req, res) => success(res, await listNotifications(getUserId(req)))));
notificationRoutes.patch("/read-all", asyncHandler(async (req, res) => {
  await Notification.updateMany({ userId: getUserId(req), readAt: null }, { $set: { readAt: new Date() } });
  return success(res, { updated: true });
}));
notificationRoutes.post("/reminders/:invoiceId/draft", asyncHandler(async (req, res) => {
  const { id } = idParam.parse({ id: req.params.invoiceId });
  return success(res, await draftReminder(getUserId(req), id));
}));
notificationRoutes.post("/reminders/:invoiceId/send", asyncHandler(async (req, res) => {
  const { id } = idParam.parse({ id: req.params.invoiceId });
  return success(res, await sendReminder(getUserId(req), id));
}));
notificationRoutes.patch("/:id", asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const parsed = readBody.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, "Invalid notification update.", "VALIDATION_ERROR", parsed.error.flatten());
  await markNotificationRead(getUserId(req), id, parsed.data.read);
  return success(res, { updated: true });
}));
notificationRoutes.delete("/:id", asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  await deleteNotification(getUserId(req), id);
  return res.status(204).end();
}));
