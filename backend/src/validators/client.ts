import { z } from "zod";

export const clientBody = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
  company: z.string().trim().max(160).optional(),
  notes: z.string().max(2000).optional(),
}).strict();

export const clientQuery = z.object({
  search: z.string().trim().max(120).optional(),
});
