import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db/mongoose";
import { RelationshipModel, FactModel, DocumentModel } from "@/lib/db/models";
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
    const relation = searchParams.get("relation");
    const docId    = searchParams.get("doc_id");
    const page     = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("page_size") ?? "20")));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: Record<string, any> = { userId, relation: { $ne: "unrelated" } };

    const validRelations = ["corroborates", "contradicts", "reconciled"];
    if (relation && validRelations.includes(relation)) {
      filter.relation = relation;
    }

    if (docId && Types.ObjectId.isValid(docId)) {
      const docFacts = await FactModel.find({ userId, docId: new Types.ObjectId(docId) }).select("_id").lean();
      const ids = docFacts.map((f) => f._id);
      filter.$or = [{ factIdA: { $in: ids } }, { factIdB: { $in: ids } }];
    }

    const [relationships, total] = await Promise.all([
      RelationshipModel.find(filter)
        .sort({ relation: 1, confidence: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      RelationshipModel.countDocuments(filter),
    ]);

    // Global summary for this user
    const summaryAgg = await RelationshipModel.aggregate([
      { $match: { userId, relation: { $ne: "unrelated" } } },
      { $group: { _id: "$relation", count: { $sum: 1 } } },
    ]);
    const summary: Record<string, number> = { corroborates: 0, contradicts: 0, reconciled: 0 };
    for (const row of summaryAgg) summary[row._id as string] = row.count;

    // Populate facts + doc names
    const allFactIds = [...relationships.map((r) => r.factIdA), ...relationships.map((r) => r.factIdB)];
    const facts = await FactModel.find({ _id: { $in: allFactIds } }).lean();
    const factMap = Object.fromEntries(facts.map((f) => [f._id.toString(), f]));

    const docIds = [...new Set(facts.map((f) => f.docId.toString()))];
    const docs = await DocumentModel.find({ _id: { $in: docIds.map((id) => new Types.ObjectId(id)) } }).select("originalName").lean();
    const docMap = Object.fromEntries(docs.map((d) => [d._id.toString(), d.originalName]));

    const result = relationships.map((r) => {
      const fa = factMap[r.factIdA.toString()];
      const fb = factMap[r.factIdB.toString()];
      return {
        id: r._id.toString(),
        fact_id_a: r.factIdA.toString(),
        fact_id_b: r.factIdB.toString(),
        relation: r.relation,
        explanation: r.explanation,
        confidence: r.confidence,
        reconciliation_context: r.reconciliationContext ?? null,
        created_at: r.createdAt,
        entity_a: fa?.entity ?? "", entity_canonical_a: fa?.entityCanonical ?? "",
        attribute_a: fa?.attribute ?? "", value_a: fa?.value ?? "",
        unit_a: fa?.unit ?? null, time_scope_a: fa?.timeScope ?? null,
        qualifiers_a: fa?.qualifiers ?? [], quote_a: fa?.quote ?? "",
        page_a: fa?.page ?? 0, doc_name_a: fa ? (docMap[fa.docId.toString()] ?? "Unknown") : "Unknown",
        entity_b: fb?.entity ?? "", entity_canonical_b: fb?.entityCanonical ?? "",
        attribute_b: fb?.attribute ?? "", value_b: fb?.value ?? "",
        unit_b: fb?.unit ?? null, time_scope_b: fb?.timeScope ?? null,
        qualifiers_b: fb?.qualifiers ?? [], quote_b: fb?.quote ?? "",
        page_b: fb?.page ?? 0, doc_name_b: fb ? (docMap[fb.docId.toString()] ?? "Unknown") : "Unknown",
      };
    });

    return NextResponse.json({ relationships: result, total, page, page_size: pageSize, summary });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
