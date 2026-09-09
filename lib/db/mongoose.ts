import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI!;

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is not set in environment variables");
}

// ── Connection caching (Next.js hot-reload safe) ──────────────────────────────
declare global {
  // eslint-disable-next-line no-var
  var _mongooseConn: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  };
}

if (!global._mongooseConn) {
  global._mongooseConn = { conn: null, promise: null };
}

export async function connectDB(): Promise<typeof mongoose> {
  if (global._mongooseConn.conn) return global._mongooseConn.conn;

  if (!global._mongooseConn.promise) {
    global._mongooseConn.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
    });
  }

  global._mongooseConn.conn = await global._mongooseConn.promise;
  return global._mongooseConn.conn;
}
