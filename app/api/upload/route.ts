import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { parseMultipartFiles } from "@/lib/upload/multer";
import { ingestDocument } from "@/lib/pipeline/ingest";
import { requireAuth } from "@/lib/auth/session";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const tempPaths: string[] = [];

  try {
    const files = await parseMultipartFiles(req);

    if (files.length === 0) {
      return NextResponse.json({ error: "No PDF files provided" }, { status: 400 });
    }

    const results = [];

    for (const file of files) {
      tempPaths.push(file.path);
      try {
        const buffer = fs.readFileSync(file.path);
        const result = await ingestDocument(buffer, file.originalname, userId);

        results.push({
          doc_id: result.docId,
          filename: file.originalname,
          facts_extracted: result.factsExtracted,
          relationships_found: result.relationshipsFound,
          skipped_duplicate: result.skippedDuplicate,
          message: result.skippedDuplicate
            ? "Document already exists — duplicate skipped"
            : `Processed: ${result.factsExtracted} facts, ${result.relationshipsFound} relationships found`,
        });
      } catch (fileErr) {
        const msg = fileErr instanceof Error ? fileErr.message : "Processing failed";
        console.error(`Failed to process ${file.originalname}:`, msg);
        results.push({ filename: file.originalname, error: msg });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    for (const p of tempPaths) {
      try { fs.unlinkSync(p); } catch { /* best-effort */ }
    }
  }
}
