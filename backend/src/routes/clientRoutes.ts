import { Router } from "express";
import { requireAuth, getUserId } from "../middleware/authMiddleware.ts";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { success } from "../utils/response.ts";
import { AppError } from "../utils/errors.js";
import { Client } from "../models/Client.js";
import { deleteClient, getClient, listClients } from "../services/clientService.js";
import { clientBody, clientQuery } from "../validators/client.js";
import { idParam } from "../validators/common.js";

export const clientRoutes = Router();
clientRoutes.use(requireAuth);

clientRoutes.get("/", validateQuery(clientQuery), asyncHandler(async (req, res) =>
  success(res, await listClients(getUserId(req), req.query.search as string | undefined))));

clientRoutes.post("/", validateBody(clientBody), asyncHandler(async (req, res) => {
  const data = { ...req.body, userId: getUserId(req) };
  if (data.email === "") delete data.email;
  return success(res, await Client.create(data), 201);
}));

clientRoutes.get("/:id", asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  return success(res, await getClient(getUserId(req), id));
}));

clientRoutes.put("/:id", validateBody(clientBody), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const data = { ...req.body };
  if (data.email === "") delete data.email;
  const client = await Client.findOneAndUpdate({ _id: id, userId: getUserId(req) }, { $set: data }, { new: true, runValidators: true }).lean();
  if (!client) throw new AppError(404, "Client not found.", "CLIENT_NOT_FOUND");
  return success(res, client);
}));

clientRoutes.delete("/:id", asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  await deleteClient(getUserId(req), id);
  return res.status(204).end();
}));
