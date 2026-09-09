/**
 * Full ingestion pipeline — scoped per user.
 *   parse PDF → chunk → extract facts → normalize → store → compare
 *
 * Every record carries userId so each user has their own isolated
 * knowledge base. Cross-document comparison only runs within the
 * same user's facts.
 */

import { Types } from "mongoose";
import { connectDB } from "@/lib/db/mongoose";
import { DocumentModel, ChunkModel, FactModel, RelationshipModel, IFact } from "@/lib/db/models";
import { parsePdf, chunkPage } from "./parse";
import { extractFactsFromChunk } from "@/lib/llm/extract";
import { compareFacts } from "@/lib/llm/compare";
import {
  normalizeEntityName,
  normalizeNumericValue,
  normalizeAttribute,
  resolveEntityCanonical,
} from "./normalize";
import { Fact } from "@/types";
import crypto from "crypto";

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function docToFact(doc: IFact & { docName?: string }): Fact {
  return {
    id: doc._id.toString(),
    doc_id: doc.docId.toString(),
    entity: doc.entity,
    entity_canonical: doc.entityCanonical,
    attribute: doc.attribute,
    value: doc.value,
    value_normalized: doc.valueNormalized ?? null,
    unit: doc.unit,
    time_scope: doc.timeScope,
    qualifiers: doc.qualifiers,
    quote: doc.quote,
    page: doc.page,
    char_start: doc.charStart,
    char_end: doc.charEnd,
    confidence: doc.confidence,
    created_at: doc.createdAt.toISOString(),
    source: doc.docName
      ? {
          doc_id: doc.docId.toString(),
          doc_name: doc.docName,
          page: doc.page,
          char_start: doc.charStart,
          char_end: doc.charEnd,
          quote: doc.quote,
        }
      : undefined,
  };
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export interface IngestResult {
  docId: string;
  factsExtracted: number;
  relationshipsFound: number;
  skippedDuplicate: boolean;
}

export async function ingestDocument(
  buffer: Buffer,
  originalName: string,
  userId: Types.ObjectId
): Promise<IngestResult> {
  await connectDB();

  const hash = sha256(buffer);

  // ── Dedup: same user, same file ───────────────────────────────────────────
  const existing = await DocumentModel.findOne({ userId, contentHash: hash })
    .select("_id")
    .lean();
  if (existing) {
    console.log(`[dedup] ${userId} already uploaded: ${originalName}`);
    return { docId: existing._id.toString(), factsExtracted: 0, relationshipsFound: 0, skippedDuplicate: true };
  }

  // ── Create document record ────────────────────────────────────────────────
  const docRecord = await DocumentModel.create({
    userId,
    filename: `${hash.slice(0, 8)}_${Date.now()}.pdf`,
    originalName,
    fileSize: buffer.length,
    contentHash: hash,
    status: "processing",
  });
  const docId = docRecord._id;

  try {
    // ── Parse PDF ─────────────────────────────────────────────────────────
    console.log(`[${docId}] Parsing: ${originalName}`);
    const { pages, totalPages } = await parsePdf(buffer);
    await DocumentModel.updateOne({ _id: docId }, { pageCount: totalPages });

    // ── Chunk ──────────────────────────────────────────────────────────────
    const allChunks = pages.flatMap((text, i) =>
      chunkPage(text, docId.toString(), i + 1)
    );

    // ── Batch-insert chunks ────────────────────────────────────────────────
    for (let i = 0; i < allChunks.length; i += 100) {
      const batch = allChunks.slice(i, i + 100);
      await ChunkModel.insertMany(
        batch.map((c) => ({
          docId,
          userId,
          page: c.page,
          chunkIndex: c.chunk_index,
          text: c.text,
          charStart: c.char_start,
          charEnd: c.char_end,
        })),
        { ordered: false }
      );
    }

    // ── Known canonicals scoped to this user ──────────────────────────────
    const knownDocs = await FactModel.distinct("entityCanonical", { userId });
    const knownCanonicals: string[] = [...knownDocs];

    // ── Extract facts (concurrency = 3) ───────────────────────────────────
    console.log(`[${docId}] Extracting from ${allChunks.length} chunks…`);
    const insertedFactIds: Types.ObjectId[] = [];
    const CONCURRENCY = 3;

    for (let i = 0; i < allChunks.length; i += CONCURRENCY) {
      const batch = allChunks.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((chunk) =>
          extractFactsFromChunk(chunk.text, originalName, chunk.page)
        )
      );

      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        for (const ef of results[j]) {
          const entityCanonical = resolveEntityCanonical(ef.entity, knownCanonicals);
          if (!knownCanonicals.includes(entityCanonical)) {
            knownCanonicals.push(entityCanonical);
          }

          const quoteIdx = chunk.text.indexOf(ef.quote);
          const charStart = quoteIdx >= 0 ? chunk.char_start + quoteIdx : chunk.char_start;
          const charEnd   = quoteIdx >= 0 ? charStart + ef.quote.length  : chunk.char_end;

          const fact = await FactModel.create({
            docId,
            userId,
            entity:          normalizeEntityName(ef.entity),
            entityCanonical,
            attribute:       normalizeAttribute(ef.attribute),
            value:           ef.value,
            valueNormalized: normalizeNumericValue(ef.value, ef.unit) ?? undefined,
            unit:      ef.unit,
            timeScope: ef.time_scope,
            qualifiers: ef.qualifiers,
            quote:      ef.quote,
            page:       chunk.page,
            charStart,
            charEnd,
            confidence: ef.confidence,
          });

          insertedFactIds.push(fact._id);
        }
      }
    }

    console.log(`[${docId}] Extracted ${insertedFactIds.length} facts`);

    // ── Comparison engine — only within this user's knowledge base ─────────
    let relationshipsFound = 0;

    if (insertedFactIds.length > 0) {
      console.log(`[${docId}] Comparing against user's existing facts…`);

      const newFacts = await FactModel.find({ _id: { $in: insertedFactIds } }).lean<IFact[]>();

      for (const nf of newFacts) {
        // Exact: same user, same entity+attribute, different document
        const exactCandidates = await FactModel.find({
          userId,
          docId: { $ne: docId },
          entityCanonical: nf.entityCanonical,
          attribute: nf.attribute,
          _id: { $nin: insertedFactIds },
        }).limit(5).lean<IFact[]>();

        // Broad: same user, same attribute, different entity spelling
        const broadCandidates = await FactModel.find({
          userId,
          docId: { $ne: docId },
          attribute: nf.attribute,
          entityCanonical: { $ne: nf.entityCanonical },
          _id: { $nin: [...insertedFactIds, ...exactCandidates.map((c) => c._id)] },
        }).limit(3).lean<IFact[]>();

        for (const candidate of [...exactCandidates, ...broadCandidates]) {
          const [idA, idB] =
            nf._id.toString() < candidate._id.toString()
              ? [nf._id, candidate._id]
              : [candidate._id, nf._id];

          const exists = await RelationshipModel.exists({ userId, factIdA: idA, factIdB: idB });
          if (exists) continue;

          // Fetch doc names for the comparison prompt
          const [docA, docB] = await Promise.all([
            DocumentModel.findById(nf.docId).select("originalName").lean(),
            DocumentModel.findById(candidate.docId).select("originalName").lean(),
          ]);

          const factA = docToFact({ ...nf, docName: docA?.originalName ?? originalName } as IFact & { docName: string });
          const factB = docToFact({ ...candidate, docName: docB?.originalName ?? "" } as IFact & { docName: string });

          const result = await compareFacts(factA, factB);

          if (result.relation !== "unrelated") {
            await RelationshipModel.create({
              userId,
              factIdA: idA,
              factIdB: idB,
              relation: result.relation,
              explanation: result.explanation,
              confidence: result.confidence,
              reconciliationContext: result.reconciliation_context,
            }).catch(() => { /* duplicate race — ignore */ });
            relationshipsFound++;
          }
        }
      }
    }

    await DocumentModel.updateOne({ _id: docId }, { status: "completed" });
    console.log(`[${docId}] Done — facts: ${insertedFactIds.length}, rels: ${relationshipsFound}`);

    return { docId: docId.toString(), factsExtracted: insertedFactIds.length, relationshipsFound, skippedDuplicate: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${docId}] Failed:`, msg);
    await DocumentModel.updateOne({ _id: docId }, { status: "failed", errorMessage: msg });
    throw err;
  }
}
