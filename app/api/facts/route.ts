import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('page_size') ?? '50')));
    const docId = searchParams.get('doc_id');
    const entity = searchParams.get('entity');
    const attribute = searchParams.get('attribute');
    const search = searchParams.get('search');

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (docId) {
      conditions.push(`f.doc_id = $${paramIdx++}`);
      params.push(docId);
    }
    if (entity) {
      conditions.push(`f.entity_canonical ILIKE $${paramIdx++}`);
      params.push(`%${entity}%`);
    }
    if (attribute) {
      conditions.push(`f.attribute ILIKE $${paramIdx++}`);
      params.push(`%${attribute}%`);
    }
    if (search) {
      conditions.push(
        `(f.entity_canonical ILIKE $${paramIdx} OR f.attribute ILIKE $${paramIdx} OR f.value ILIKE $${paramIdx} OR f.quote ILIKE $${paramIdx})`
      );
      params.push(`%${search}%`);
      paramIdx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;

    const facts = await query(
      `SELECT
        f.id,
        f.doc_id,
        f.entity,
        f.entity_canonical,
        f.attribute,
        f.value,
        f.value_normalized,
        f.unit,
        f.time_scope,
        f.qualifiers,
        f.quote,
        f.page,
        f.char_start,
        f.char_end,
        f.confidence,
        f.created_at,
        d.original_name AS doc_name
      FROM facts f
      JOIN documents d ON d.id = f.doc_id
      ${where}
      ORDER BY f.created_at DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, pageSize, offset]
    );

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM facts f ${where}`,
      params
    );
    const total = parseInt(countResult[0]?.count ?? '0');

    return NextResponse.json({
      facts,
      total,
      page,
      page_size: pageSize,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
