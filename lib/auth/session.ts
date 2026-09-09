import { getServerSession } from "next-auth";
import { authOptions } from "./config";
import { NextResponse } from "next/server";
import { Types } from "mongoose";

/**
 * Call from any App-Router route handler to get the authenticated userId.
 * Returns { userId } on success, or a 401 NextResponse if not authenticated.
 */
export async function requireAuth(): Promise<
  { userId: Types.ObjectId; error: null } |
  { userId: null; error: NextResponse }
> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return {
      userId: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { userId: new Types.ObjectId(session.user.id), error: null };
}
