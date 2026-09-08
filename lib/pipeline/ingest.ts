/**
 * Full ingestion pipeline:
 *   parse PDF → chunk → extract facts → normalize → store → compare
 */

import { query, queryOne } from '@/lib/db';
import { parsePdf, chunkPage } from './parse';
import { extractFactsFromChunk } from '@/lib/llm/extract';
import { compareFacts } from '@/lib/llm/compare';
import {
  normalizeEntityName,
  normalizeNumericValue,
  normalizeAttribute,
  resolveEntityCanonical,
} from './normalize';
import { Fact } from '@/types';
import crypto from 'crypto';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function updateDocumentStatus(
  docId: string,
  status: string,
  extra: Record<string, unknown> = {}
) {
  if (extra.page_count !== undefined && extra.error_message !== undefined) {
    await query(
      'UPDATE documents SET status = $2, page_count = $3, error_message = $4, updated_at = NOW() WHERE id = $1',
      [docId, status, extra.page_count, extra.error_message]
    );
  } else if (extra.page_count !== undefined) {
    await query(
      'UPDATE documents SET status = $2, page_count = $3, updated_at = NOW() WHERE id = $1',
      [docId, status, extra.page_count]
    );
  } else if (extra.error_message !== undefined) {
    await query(
      'UPDATE documents SET status = $2, error_message = $3, updated_at = NOW() WHERE id = $1',
      [docId, status, extra.error_message]
    );
  } else {
    await query(
      'UPDATE documents SET status = $2, updated_at = NOW() WHERE id = $1',
      [docId, status]
    );
  }
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

export interface IngestResult {
  docId: string;
  factsExtracted: number;
  relationshipsFound: number;
  skippedDuplicate: boolean;
}

export async function ingestDocument(
  buffer: Buffer,
  originalName: string
): Promise<IngestResult> {
  const hash = sha256(buffer);

  // ── Dedup check ────────────────────────────────────────────────────────────
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM documents WHERE content_hash = $1',
    [hash]
  );
  if (existing) {
    console.log(`Document already ingested: ${originalName} (hash match ${existing.id})`);
    return { docId: existing.id, factsExtracted: 0, relationshipsFound: 0, skippedDuplicate: true };
  }

  // ── Create document record ─────────────────────────────────────────────────
  const filename = `${hash.slice(0, 8)}_${Date.now()}.pdf`;
  const docRow = await queryOne<{ id: string }>(
    `INSERT INTO documents (filename, original_name, file_size, content_hash, status)
     VALUES ($1, $2, $3, $4, 'processing')
     RETURNING id`,
    [filename, originalName, buffer.length, hash]
  );
  if (!docRow) throw new Error('Failed to create document record');
  const docId = docRow.id;

  try {
    // ── Parse PDF ─────────────────────────────────────────────────────────────
    console.log(`[${docId}] Parsing PDF: ${originalName}`);
    const { pages, totalPages } = await parsePdf(buffer);
    await updateDocumentStatus(docId, 'processing', { page_count: totalPages });

    // ── Chunk pages ───────────────────────────────────────────────────────────
    const allChunks = pages.flatMap((pageText, i) =>
      chunkPage(pageText, docId, i + 1)
    );

    // ── Batch insert chunks (50 at a time) ────────────────────────────────────
    for (let i = 0; i < allChunks.length; i += 50) {
      const batch = allChunks.slice(i, i + 50);
      const vals = batch
        .map(
          (_, j) =>
            `($${j * 6 + 1}, $${j * 6 + 2}, $${j * 6 + 3}, $${j * 6 + 4}, $${j * 6 + 5}, $${j * 6 + 6})`
        )
        .join(', ');
      const params = batch.flatMap((c) => [
        c.doc_id,
        c.page,
        c.chunk_index,
        c.text,
        c.char_start,
        c.char_end,
      ]);
      await query(
        `INSERT INTO chunks (doc_id, page, chunk_index, text, char_start, char_end) VALUES ${vals}`,
        params
      );
    }

    // ── Get existing entity canonicals for within-doc resolution ──────────────
    const existingEntities = await query<{ entity_canonical: string }>(
      'SELECT DISTINCT entity_canonical FROM facts'
    );
    const knownCanonicals = existingEntities.map((r) => r.entity_canonical);

    // ── Extract facts from each chunk ─────────────────────────────────────────
    console.log(`[${docId}] Extracting facts from ${allChunks.length} chunks...`);
    const insertedFactIds: string[] = [];

    // Process in parallel batches (concurrency=3 to respect rate limits)
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
        const extracted = results[j];

        for (const ef of extracted) {
          const canonicalEntity = resolveEntityCanonical(ef.entity, knownCanonicals);
          const normalizedEntity = normalizeEntityName(ef.entity);
          const normalizedAttr = normalizeAttribute(ef.attribute);
          const valueNormalized = normalizeNumericValue(ef.value, ef.unit);

          // Track new canonical for within-document resolution
          if (!knownCanonicals.includes(canonicalEntity)) {
            knownCanonicals.push(canonicalEntity);
          }

          // Locate quote within chunk to compute absolute char offsets
          const quoteIdx = chunk.text.indexOf(ef.quote);
          const charStart =
            quoteIdx >= 0 ? chunk.char_start + quoteIdx : chunk.char_start;
          const charEnd =
            quoteIdx >= 0 ? charStart + ef.quote.length : chunk.char_end;

          const factRow = await queryOne<{ id: string }>(
            `INSERT INTO facts
              (doc_id, entity, entity_canonical, attribute, value, value_normalized,
               unit, time_scope, qualifiers, quote, page, char_start, char_end, confidence)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             RETURNING id`,
            [
              docId,
              normalizedEntity,
              canonicalEntity,
              normalizedAttr,
              ef.value,
              valueNormalized,
              ef.unit ?? null,
              ef.time_scope ?? null,
              JSON.stringify(ef.qualifiers),
              ef.quote,
              chunk.page,
              charStart,
              charEnd,
              ef.confidence,
            ]
          );

          if (factRow) {
            insertedFactIds.push(factRow.id);
          }
        }
      }
    }

    console.log(`[${docId}] Extracted ${insertedFactIds.length} facts`);

    // ── Comparison engine ─────────────────────────────────────────────────────
    let relationshipsFound = 0;

    if (insertedFactIds.length > 0) {
      console.log(`[${docId}] Running comparison engine...`);

      // Fetch the newly inserted facts with their document name
      const newFacts = await query<Fact & { doc_name: string }>(
        `SELECT f.*, d.original_name as doc_name
         FROM facts f
         JOIN documents d ON d.id = f.doc_id
         WHERE f.id = ANY($1)`,
        [insertedFactIds]
      );

      for (const newFact of newFacts) {
        // Find candidates: same entity + attribute from OTHER documents
        const candidates = await query<Fact & { doc_name: string }>(
          `SELECT f.*, d.original_name as doc_name
           FROM facts f
           JOIN documents d ON d.id = f.doc_id
           WHERE f.doc_id != $1
             AND f.entity_canonical = $2
             AND f.attribute = $3
             AND NOT (f.id = ANY($4))
           LIMIT 5`,
          [docId, newFact.entity_canonical, newFact.attribute, insertedFactIds]
        );

        // Also try broader attribute-only match for different entity spellings
        const broadCandidates = await query<Fact & { doc_name: string }>(
          `SELECT f.*, d.original_name as doc_name
           FROM facts f
           JOIN documents d ON d.id = f.doc_id
           WHERE f.doc_id != $1
             AND f.attribute = $2
             AND f.entity_canonical != $3
             AND NOT (f.id = ANY($4))
           LIMIT 3`,
          [docId, newFact.attribute, newFact.entity_canonical, insertedFactIds]
        ).catch(() => [] as Array<Fact & { doc_name: string }>);

        const allCandidates = [
          ...candidates,
          ...broadCandidates.filter((c) => !candidates.some((x) => x.id === c.id)),
        ];

        for (const candidate of allCandidates) {
          // Skip if relationship already recorded
          const alreadyExists = await queryOne(
            `SELECT id FROM relationships
             WHERE (fact_id_a = $1 AND fact_id_b = $2)
                OR (fact_id_a = $2 AND fact_id_b = $1)`,
            [newFact.id, candidate.id]
          );
          if (alreadyExists) continue;

          // Attach source info for the LLM prompt
          const factAWithSource: Fact = {
            ...newFact,
            source: {
              doc_id: newFact.doc_id,
              doc_name: newFact.doc_name,
              page: newFact.page,
              char_start: newFact.char_start,
              char_end: newFact.char_end,
              quote: newFact.quote,
            },
          };
          const factBWithSource: Fact = {
            ...candidate,
            source: {
              doc_id: candidate.doc_id,
              doc_name: candidate.doc_name,
              page: candidate.page,
              char_start: candidate.char_start,
              char_end: candidate.char_end,
              quote: candidate.quote,
            },
          };

          const result = await compareFacts(factAWithSource, factBWithSource);

          if (result.relation !== 'unrelated') {
            // Ensure stable ordering for the UNIQUE constraint
            const [idA, idB] =
              newFact.id < candidate.id
                ? [newFact.id, candidate.id]
                : [candidate.id, newFact.id];

            await query(
              `INSERT INTO relationships
                (fact_id_a, fact_id_b, relation, explanation, confidence, reconciliation_context)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (fact_id_a, fact_id_b) DO NOTHING`,
              [
                idA,
                idB,
                result.relation,
                result.explanation,
                result.confidence,
                result.reconciliation_context ?? null,
              ]
            );
            relationshipsFound++;
          }
        }
      }
    }

    await updateDocumentStatus(docId, 'completed');
    console.log(
      `[${docId}] Done. Facts: ${insertedFactIds.length}, Relationships: ${relationshipsFound}`
    );

    return {
      docId,
      factsExtracted: insertedFactIds.length,
      relationshipsFound,
      skippedDuplicate: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${docId}] Ingestion failed:`, message);
    await updateDocumentStatus(docId, 'failed', { error_message: message });
    throw err;
  }
}
