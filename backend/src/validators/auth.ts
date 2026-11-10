import { z } from "zod";

export const registerBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(128),
});

export const loginBody = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});
