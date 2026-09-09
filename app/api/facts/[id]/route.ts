import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db/mongoose";
import { FactModel, ChunkModel, RelationshipModel, DocumentModel } from "@/lib/db/models";
import { Types } from "mongoose";
import { requireAuth } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { userId } = auth;

  try {
    await connectDB();
    const { id } = params;
    if (!Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid fact ID" }, { status: 400 });
    }

    // Ensure fact belongs to the authenticated user
    const fact = await FactModel.findOne({ _id: id, userId }).lean();
    if (!fact) return NextResponse.json({ error: "Fact not found" }, { status: 404 });

    const doc = await DocumentModel.findById(fact.docId).select("originalName").lean();

    const context = await ChunkModel.findOne({ docId: fact.docId, page: fact.page }).sort({ charStart: 1 }).lean();

    const relationships = await RelationshipModel.find({
      userId,
      $or: [{ factIdA: fact._id }, { factIdB: fact._id }],
    }).lean();

    const relWithFacts = await Promise.all(
      relationships.map(async (r) => {
        const [fa, fb] = await Promise.all([
          FactModel.findById(r.factIdA).lean(),
          FactModel.findById(r.factIdB).lean(),
        ]);
        const [da, db] = await Promise.all([
          DocumentModel.findById(fa?.docId).select("originalName").lean(),
          DocumentModel.findById(fb?.docId).select("originalName").lean(),
        ]);
        return {
          id: r._id.toString(),
          relation: r.relation,
          explanation: r.explanation,
          confidence: r.confidence,
          reconciliation_context: r.reconciliationContext,
          fact_a: fa ? { id: fa._id.toString(), entity: fa.entity, attribute: fa.attribute, value: fa.value, unit: fa.unit, time_scope: fa.timeScope, quote: fa.quote, page: fa.page, doc_name: da?.originalName ?? "Unknown" } : null,
          fact_b: fb ? { id: fb._id.toString(), entity: fb.entity, attribute: fb.attribute, value: fb.value, unit: fb.unit, time_scope: fb.timeScope, quote: fb.quote, page: fb.page, doc_name: db?.originalName ?? "Unknown" } : null,
        };
      })
    );

    return NextResponse.json({
      fact: {
        id: fact._id.toString(), doc_id: fact.docId.toString(), doc_name: doc?.originalName ?? "Unknown",
        entity: fact.entity, entity_canonical: fact.entityCanonical, attribute: fact.attribute,
        value: fact.value, value_normalized: fact.valueNormalized ?? null, unit: fact.unit ?? null,
        time_scope: fact.timeScope ?? null, qualifiers: fact.qualifiers, quote: fact.quote,
        page: fact.page, char_start: fact.charStart, char_end: fact.charEnd, confidence: fact.confidence,
      },
      context: context ? { text: context.text, char_start: context.charStart, char_end: context.charEnd } : null,
      relationships: relWithFacts,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
