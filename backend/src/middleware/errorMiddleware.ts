import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/errors.js";

export const errorMiddleware: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => ({
      field: issue.path.map(String).join(".") || "request",
      message: issue.message,
      code: issue.code,
    }));
    console.warn("API request validation failed", {
      method: _req.method,
      path: _req.path,
      issues: issues.map(({ field, message, code }) => ({ field, message, code })),
    });
    const firstIssue = issues[0];
    const message = firstIssue
      ? `Invalid request field "${firstIssue.field}": ${firstIssue.message}`
      : "Request validation failed.";
    res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message, details: { issues } },
    });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    });
    return;
  }
  if (error instanceof Error && error.name === "CastError") {
    res.status(400).json({ success: false, error: { code: "INVALID_ID", message: "A supplied identifier is invalid." } });
    return;
  }
  if (error instanceof Error && error.name === "ValidationError") {
    res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: error.message } });
    return;
  }
  if (error instanceof Error && "code" in error && error.code === 11000) {
    res.status(409).json({ success: false, error: { code: "DUPLICATE_RECORD", message: "A record with the supplied unique value already exists." } });
    return;
  }
  console.error("Unhandled API error", error);
  res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." } });
};
