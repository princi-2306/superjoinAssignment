import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db/mongoose";
import { FactModel, DocumentModel } from "@/lib/db/models";
import { Types } from "mongoose";
import { requireAuth } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { userId } = auth;

  try {
    await connectDB();

    const { searchParams } = new URL(req.url);
    const page     = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("page_size") ?? "50")));
    const docId    = searchParams.get("doc_id");
    const entity   = searchParams.get("entity");
    const attribute = searchParams.get("attribute");
    const search   = searchParams.get("search");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: Record<string, any> = { userId };

    if (docId && Types.ObjectId.isValid(docId)) {
      filter.docId = new Types.ObjectId(docId);
    }
    if (entity)    filter.entityCanonical = { $regex: entity,    $options: "i" };
    if (attribute) filter.attribute       = { $regex: attribute, $options: "i" };
    if (search) {
      filter.$or = [
        { entityCanonical: { $regex: search, $options: "i" } },
        { attribute:       { $regex: search, $options: "i" } },
        { value:           { $regex: search, $options: "i" } },
        { quote:           { $regex: search, $options: "i" } },
      ];
    }

    const [facts, total] = await Promise.all([
      FactModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      FactModel.countDocuments(filter),
    ]);

    const docIds = [...new Set(facts.map((f) => f.docId.toString()))];
    const docs = await DocumentModel.find({
      _id: { $in: docIds.map((id) => new Types.ObjectId(id)) },
    }).select("originalName").lean();
    const docNameMap = Object.fromEntries(docs.map((d) => [d._id.toString(), d.originalName]));

    const result = facts.map((f) => ({
      id:               f._id.toString(),
      doc_id:           f.docId.toString(),
      doc_name:         docNameMap[f.docId.toString()] ?? "Unknown",
      entity:           f.entity,
      entity_canonical: f.entityCanonical,
      attribute:        f.attribute,
      value:            f.value,
      value_normalized: f.valueNormalized ?? null,
      unit:             f.unit ?? null,
      time_scope:       f.timeScope ?? null,
      qualifiers:       f.qualifiers,
      quote:            f.quote,
      page:             f.page,
      char_start:       f.charStart,
      char_end:         f.charEnd,
      confidence:       f.confidence,
      created_at:       f.createdAt,
    }));

    return NextResponse.json({ facts: result, total, page, page_size: pageSize });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
