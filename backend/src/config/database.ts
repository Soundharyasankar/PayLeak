
import { setServers, getServers, promises as dns } from "node:dns";
import mongoose from "mongoose";
import { env } from "./env.js";

const DATABASE_NAME = "payleak";

function configureMongoDns() {
  if (!env.MONGODB_URI.startsWith("mongodb+srv://")) {
    return;
  }

  const servers = env.MONGODB_DNS_SERVERS
    .split(",")
    .map((server) => server.trim())
    .filter(Boolean);

  if (servers.length === 0) {
    throw new Error("No MongoDB DNS servers configured.");
  }

  try {
    setServers(servers);
    console.log("MongoDB DNS servers:", getServers());
  } catch {
    throw new Error(
      "Invalid MONGODB_DNS_SERVERS configuration."
    );
  }
}

async function verifyMongoDns() {
  if (!env.MONGODB_URI.startsWith("mongodb+srv://")) {
    return;
  }

  const hostname = env.MONGODB_URI
    .replace("mongodb+srv://", "")
    .split("@")
    .pop()
    ?.split("/")[0]
    ?.split("?")[0];

  if (!hostname) {
    throw new Error("Invalid MongoDB Atlas connection string.");
  }

  try {
    const records = await dns.resolveSrv(`_mongodb._tcp.${hostname}`);

    if (records.length === 0) {
      throw new Error("No MongoDB SRV records found.");
    }

    console.log(`MongoDB DNS resolved ${records.length} server records.`);
  } catch (error) {
    console.error("MongoDB DNS verification failed:", error);
    throw new Error(
      "MongoDB DNS lookup failed. Check DNS servers and network connectivity."
    );
  }
}

function getConnectionFailureMessage(error: unknown) {
  const messages: string[] = [];
  const codes: string[] = [];
  const visited = new Set<object>();
  let current: unknown = error;

  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);

    const item = current as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      syscall?: unknown;
      cause?: unknown;
    };

    if (typeof item.name === "string") messages.push(item.name);
    if (typeof item.message === "string") messages.push(item.message);
    if (typeof item.code === "string" || typeof item.code === "number") {
      codes.push(String(item.code));
    }
    if (typeof item.syscall === "string") messages.push(item.syscall);

    current = item.cause;
  }

  const details = messages.join(" ").toLowerCase();

  if (
    details.includes("querysrv") ||
    details.includes("querytxt") ||
    codes.some((code) =>
      ["ENOTFOUND", "EAI_AGAIN"].includes(code)
    )
  ) {
    return "MongoDB DNS resolution failed. Check your DNS configuration.";
  }

  if (
    codes.includes("18") ||
    /authentication failed|authenticationfailure|authenticationfailed/.test(details)
  ) {
    return "MongoDB authentication failed. Verify your Atlas database username and password.";
  }

  if (
    /replicasetnoprimary|server selection timed out|mongonetworkerror|etimedout|econnrefused|enetworkunreachable|ehostunreach|econnreset/.test(details)
  ) {
    return "MongoDB Atlas has no reachable primary. Confirm the cluster is running, the client IP is allowed in Atlas Network Access, outbound TCP 27017 is permitted, and the connection string is current.";
  }

  return "MongoDB connection failed. Verify your connection string and Atlas configuration.";
}

export async function connectDatabase() {
  configureMongoDns();

  await verifyMongoDns();

  try {
    await mongoose.connect(env.MONGODB_URI, {
      dbName: DATABASE_NAME,
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 10000,
    });

    const connectedDatabase = mongoose.connection.db?.databaseName;
    if (connectedDatabase !== DATABASE_NAME) {
      await mongoose.disconnect();
      throw new Error(`Connected to unexpected MongoDB database "${connectedDatabase ?? "unknown"}".`);
    }

    console.log(`MongoDB Connected Successfully (database: ${connectedDatabase})`);
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("Connected to unexpected MongoDB database")
      ? error.message
      : getConnectionFailureMessage(error);
    console.error(message);
    throw new Error(message);
  }
}
