import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    const documents = await query<{
      id: string;
      filename: string;
      original_name: string;
      file_size: number;
      page_count: number;
      status: string;
      error_message: string | null;
      created_at: string;
      updated_at: string;
      fact_count: number;
    }>(
      `SELECT
        d.id,
        d.filename,
        d.original_name,
        d.file_size,
        d.page_count,
        d.status,
        d.error_message,
        d.created_at,
        d.updated_at,
        COUNT(f.id)::int AS fact_count
      FROM documents d
      LEFT JOIN facts f ON f.doc_id = d.id
      GROUP BY d.id
      ORDER BY d.created_at DESC`
    );

    return NextResponse.json({ documents });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
