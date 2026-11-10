import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { User } from "../models/User.ts";
import { AppError } from "../utils/errors.js";

const accessTokenLifetime = "8h";

function issueToken(user: { _id: unknown; email: string }) {
  return jwt.sign({ email: user.email }, env.JWT_SECRET, { subject: String(user._id), expiresIn: accessTokenLifetime });
}

export async function registerUser(input: { name: string; email: string; password: string }) {
  const email = input.email.trim().toLowerCase();
  if (await User.exists({ email })) throw new AppError(409, "An account with this email already exists.", "EMAIL_IN_USE");
  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    const user = await User.create({ name: input.name.trim(), email, passwordHash });
    return { user: { id: String(user._id), name: user.name, email: user.email }, accessToken: issueToken(user) };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === 11000) {
      throw new AppError(409, "An account with this email already exists.", "EMAIL_IN_USE");
    }
    throw error;
  }
}

export async function loginUser(input: { email: string; password: string }) {
  const email = input.email.trim().toLowerCase();
  const user = await User.findOne({ email }).select("+passwordHash");
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new AppError(401, "Email or password is incorrect.", "INVALID_CREDENTIALS");
  }
  return { user: { id: String(user._id), name: user.name, email: user.email }, accessToken: issueToken(user) };
}
