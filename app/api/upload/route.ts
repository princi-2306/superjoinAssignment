import { NextRequest, NextResponse } from 'next/server';
import { ingestDocument } from '@/lib/pipeline/ingest';

export const maxDuration = 300; // 5 min for large PDFs

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const results = [];

    for (const file of files) {
      if (!file.name.endsWith('.pdf') && file.type !== 'application/pdf') {
        results.push({
          filename: file.name,
          error: 'Only PDF files are supported',
        });
        continue;
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await ingestDocument(buffer, file.name);

      results.push({
        doc_id: result.docId,
        filename: file.name,
        facts_extracted: result.factsExtracted,
        relationships_found: result.relationshipsFound,
        skipped_duplicate: result.skippedDuplicate,
        message: result.skippedDuplicate
          ? 'Document already exists (duplicate skipped)'
          : `Successfully processed: ${result.factsExtracted} facts, ${result.relationshipsFound} relationships`,
      });
    }

    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Upload error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
