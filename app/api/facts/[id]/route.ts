import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    const fact = await queryOne(
      `SELECT
        f.*,
        d.original_name AS doc_name
      FROM facts f
      JOIN documents d ON d.id = f.doc_id
      WHERE f.id = $1`,
      [id]
    );

    if (!fact) {
      return NextResponse.json({ error: 'Fact not found' }, { status: 404 });
    }

    // Get surrounding context (neighboring chunks from same page)
    const context = await queryOne(
      `SELECT text, char_start, char_end
       FROM chunks
       WHERE doc_id = (SELECT doc_id FROM facts WHERE id = $1)
         AND page = (SELECT page FROM facts WHERE id = $1)
       ORDER BY ABS(char_start - (SELECT char_start FROM facts WHERE id = $1))
       LIMIT 1`,
      [id]
    );

    // Get related relationships
    const relationships = await query(
      `SELECT
        r.*,
        fa.entity AS entity_a, fa.attribute AS attr_a, fa.value AS value_a,
        fa.unit AS unit_a, fa.time_scope AS scope_a, fa.quote AS quote_a,
        da.original_name AS doc_name_a,
        fb.entity AS entity_b, fb.attribute AS attr_b, fb.value AS value_b,
        fb.unit AS unit_b, fb.time_scope AS scope_b, fb.quote AS quote_b,
        db.original_name AS doc_name_b
      FROM relationships r
      JOIN facts fa ON fa.id = r.fact_id_a
      JOIN facts fb ON fb.id = r.fact_id_b
      JOIN documents da ON da.id = fa.doc_id
      JOIN documents db ON db.id = fb.doc_id
      WHERE r.fact_id_a = $1 OR r.fact_id_b = $1`,
      [id]
    );

    return NextResponse.json({ fact, context, relationships });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
