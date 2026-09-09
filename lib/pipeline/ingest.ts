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

    // ── Known canonicals scoped to this user ──────────────────────────────
    const knownDocs = await FactModel.distinct("entityCanonical", { userId });
    const knownCanonicals: string[] = [...knownDocs];

    // ── Extract and process per-page to avoid retaining all chunks in memory
    console.log(`[${docId}] Extracting from ${pages.length} pages (streamed per-page)…`);
    const CONCURRENCY = 3;
    let relationshipsFound = 0;
    let factsExtractedCount = 0;

    for (let p = 0; p < pages.length; p++) {
      const pageText = pages[p];
      const pageNumber = p + 1;

      // Chunk the page (keeps only one page of chunks in memory at a time)
      const pageChunks = chunkPage(pageText, docId.toString(), pageNumber);

      // Insert chunks for this page in batches
      for (let i = 0; i < pageChunks.length; i += 100) {
        const batch = pageChunks.slice(i, i + 100);
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

      // Extract and immediately persist/compare facts for this page's chunks
      for (let i = 0; i < pageChunks.length; i += CONCURRENCY) {
        const batch = pageChunks.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          batch.map((chunk) => extractFactsFromChunk(chunk.text, originalName, chunk.page))
        );

        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
          for (const ef of results[j]) {
            const entityCanonical = resolveEntityCanonical(ef.entity, knownCanonicals);
            if (!knownCanonicals.includes(entityCanonical)) knownCanonicals.push(entityCanonical);

            const quoteIdx = chunk.text.indexOf(ef.quote);
            const charStart = quoteIdx >= 0 ? chunk.char_start + quoteIdx : chunk.char_start;
            const charEnd = quoteIdx >= 0 ? charStart + ef.quote.length : chunk.char_end;

            console.log(`[${docId}] Creating fact: entity="${ef.entity}", attribute="${ef.attribute}", page=${chunk.page}`);
            const factDoc = await FactModel.create({
              docId,
              userId,
              entity: normalizeEntityName(ef.entity),
              entityCanonical,
              attribute: normalizeAttribute(ef.attribute),
              value: ef.value,
              valueNormalized: normalizeNumericValue(ef.value, ef.unit) ?? undefined,
              unit: ef.unit,
              timeScope: ef.time_scope,
              qualifiers: ef.qualifiers,
              quote: ef.quote,
              page: chunk.page,
              charStart,
              charEnd,
              confidence: ef.confidence,
            });

            factsExtractedCount++;

            // Immediately compare this new fact against existing facts in the user's KB
            const nf = factDoc.toObject() as IFact;

            // Exact: same user, same entity+attribute, different document
            const exactCandidates = await FactModel.find({
              userId,
              docId: { $ne: docId },
              entityCanonical: nf.entityCanonical,
              attribute: nf.attribute,
              _id: { $ne: nf._id },
            }).limit(5).lean<IFact[]>();

            // Broad: same user, same attribute, different entity spelling
            const broadCandidates = await FactModel.find({
              userId,
              docId: { $ne: docId },
              attribute: nf.attribute,
              entityCanonical: { $ne: nf.entityCanonical },
              _id: { $ne: nf._id },
            }).limit(3).lean<IFact[]>();

            for (const candidate of [...exactCandidates, ...broadCandidates]) {
              const [idA, idB] =
                nf._id.toString() < candidate._id.toString()
                  ? [nf._id, candidate._id]
                  : [candidate._id, nf._id];

              const exists = await RelationshipModel.exists({ userId, factIdA: idA, factIdB: idB });
              if (exists) continue;

              const [docA, docB] = await Promise.all([
                DocumentModel.findById(nf.docId).select("originalName").lean(),
                DocumentModel.findById(candidate.docId).select("originalName").lean(),
              ]);

              const factA = docToFact({ ...nf, docName: docA?.originalName ?? originalName } as IFact & { docName: string });
              const factB = docToFact({ ...candidate, docName: docB?.originalName ?? "" } as IFact & { docName: string });

              const result = await compareFacts(factA, factB);

              if (result.relation !== "unrelated") {
                console.log(`[${docId}] Creating relationship between ${idA} and ${idB}: ${result.relation} (confidence=${result.confidence})`);
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
      }

      // Allow the per-page data to be GC'd by letting references go out of scope
    }

    console.log(`[${docId}] Done — relationships found: ${relationshipsFound}`);

    await DocumentModel.updateOne({ _id: docId }, { status: "completed" });
    console.log(`[${docId}] Done — facts: ${factsExtractedCount}, rels: ${relationshipsFound}`);

    return { docId: docId.toString(), factsExtracted: factsExtractedCount, relationshipsFound, skippedDuplicate: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${docId}] Failed:`, msg);
    await DocumentModel.updateOne({ _id: docId }, { status: "failed", errorMessage: msg });
    throw err;
  }
}
