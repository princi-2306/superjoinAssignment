import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const relation = searchParams.get('relation'); // filter by type
    const docId = searchParams.get('doc_id');
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('page_size') ?? '20')));

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (relation && ['corroborates', 'contradicts', 'reconciled'].includes(relation)) {
      conditions.push(`r.relation = $${paramIdx++}`);
      params.push(relation);
    }

    if (docId) {
      conditions.push(`(fa.doc_id = $${paramIdx} OR fb.doc_id = $${paramIdx})`);
      params.push(docId);
      paramIdx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;

    const relationships = await query(
      `SELECT
        r.id,
        r.fact_id_a,
        r.fact_id_b,
        r.relation,
        r.explanation,
        r.confidence,
        r.reconciliation_context,
        r.created_at,
        -- Fact A
        fa.entity       AS entity_a,
        fa.entity_canonical AS entity_canonical_a,
        fa.attribute    AS attribute_a,
        fa.value        AS value_a,
        fa.unit         AS unit_a,
        fa.time_scope   AS time_scope_a,
        fa.qualifiers   AS qualifiers_a,
        fa.quote        AS quote_a,
        fa.page         AS page_a,
        fa.confidence   AS confidence_a,
        da.original_name AS doc_name_a,
        da.id           AS doc_id_a,
        -- Fact B
        fb.entity       AS entity_b,
        fb.entity_canonical AS entity_canonical_b,
        fb.attribute    AS attribute_b,
        fb.value        AS value_b,
        fb.unit         AS unit_b,
        fb.time_scope   AS time_scope_b,
        fb.qualifiers   AS qualifiers_b,
        fb.quote        AS quote_b,
        fb.page         AS page_b,
        fb.confidence   AS confidence_b,
        db.original_name AS doc_name_b,
        db.id           AS doc_id_b
      FROM relationships r
      JOIN facts fa ON fa.id = r.fact_id_a
      JOIN facts fb ON fb.id = r.fact_id_b
      JOIN documents da ON da.id = fa.doc_id
      JOIN documents db ON db.id = fb.doc_id
      ${where}
      ORDER BY
        CASE r.relation
          WHEN 'contradicts' THEN 1
          WHEN 'reconciled'  THEN 2
          WHEN 'corroborates' THEN 3
          ELSE 4
        END,
        r.confidence DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, pageSize, offset]
    );

    // Summary counts
    const summary = await query<{ relation: string; count: string }>(
      `SELECT r.relation, COUNT(*) as count
       FROM relationships r
       JOIN facts fa ON fa.id = r.fact_id_a
       JOIN facts fb ON fb.id = r.fact_id_b
       GROUP BY r.relation`
    );

    const summaryMap = summary.reduce(
      (acc, row) => ({ ...acc, [row.relation]: parseInt(row.count) }),
      { corroborates: 0, contradicts: 0, reconciled: 0 }
    );

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM relationships r
       JOIN facts fa ON fa.id = r.fact_id_a
       JOIN facts fb ON fb.id = r.fact_id_b
       ${where}`,
      params
    );
    const total = parseInt(countResult[0]?.count ?? '0');

    return NextResponse.json({
      relationships,
      total,
      page,
      page_size: pageSize,
      summary: summaryMap,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
