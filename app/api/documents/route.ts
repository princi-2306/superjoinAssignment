import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db/mongoose";
import { DocumentModel, FactModel } from "@/lib/db/models";
import { requireAuth } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { userId } = auth;

  try {
    await connectDB();

    const documents = await DocumentModel.find({ userId }).sort({ createdAt: -1 }).lean();

    const counts = await FactModel.aggregate([
      { $match: { userId } },
      { $group: { _id: "$docId", count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(counts.map((c) => [c._id.toString(), c.count]));

    const result = documents.map((doc) => ({
      id: doc._id.toString(),
      filename: doc.filename,
      original_name: doc.originalName,
      file_size: doc.fileSize,
      page_count: doc.pageCount,
      status: doc.status,
      error_message: doc.errorMessage ?? null,
      created_at: doc.createdAt,
      updated_at: doc.updatedAt,
      fact_count: countMap[doc._id.toString()] ?? 0,
    }));

    return NextResponse.json({ documents: result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
