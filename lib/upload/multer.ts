/**
 * Multer adapter for Next.js App Router.
 *
 * Next.js App Router routes are standard Web API Request objects — not
 * Node.js IncomingMessage. Multer needs the latter, so we bridge them
 * by converting the incoming ReadableStream into a Node.js Readable and
 * wrapping it in a minimal IncomingMessage-compatible object.
 *
 * Files are written to /tmp (disk storage) to avoid heap OOM on large PDFs.
 * After processing, callers must delete the temp files.
 */

import multer from "multer";
import os from "os";
import path from "path";
import { Readable } from "stream";
import type { IncomingMessage } from "http";
import type { NextRequest } from "next/server";

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  path: string; // absolute path to temp file on disk
}

// ── Multer instance — disk storage in OS temp dir ─────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, os.tmpdir()),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 200 * 1024 * 1024, // 200 MB per file
    files: 20,
  },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "application/pdf" ||
      file.originalname.toLowerCase().endsWith(".pdf");
    cb(null, ok);
  },
});

// ── Bridge: NextRequest → fake IncomingMessage ────────────────────────────────

function toNodeRequest(req: NextRequest): IncomingMessage {
  // Convert Web ReadableStream to Node.js Readable
  const nodeReadable = req.body
    ? Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0])
    : Readable.from([]);

  // Multer reads headers and method from IncomingMessage
  const fakeReq = Object.assign(nodeReadable, {
    headers: Object.fromEntries(req.headers.entries()),
    method: req.method,
    url: req.url,
  }) as unknown as IncomingMessage;

  return fakeReq;
}

// ── Public helper: parse multipart/form-data and return files ─────────────────

export function parseMultipartFiles(req: NextRequest): Promise<UploadedFile[]> {
  return new Promise((resolve, reject) => {
    console.log('[upload] parseMultipartFiles: called');
    const nodeReq = toNodeRequest(req);

    console.log('[upload] headers:', Object.fromEntries(req.headers.entries()));

    // Multer only touches req — it never writes to res in diskStorage mode.
    // Cast to `never` so TypeScript doesn't argue about the Express Response shape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    upload.array("files")(nodeReq as never, {} as never, (err) => {
      if (err) {
        console.error('[upload] multer error:', err && (err as Error).message ? (err as Error).message : err);
        return reject(err);
      }

      const files = (nodeReq as unknown as { files?: Express.Multer.File[] })
        .files as Express.Multer.File[] | undefined;

      if (!files || files.length === 0) {
        console.log('[upload] no files parsed by multer');
        return resolve([]);
      }

      console.log(`[upload] multer parsed ${files.length} file(s)`);
      for (const f of files) console.log('[upload] file:', f.originalname, f.path, f.size);

      resolve(
        files.map((f) => ({
          fieldname: f.fieldname,
          originalname: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
          path: f.path,
        }))
      );
    });
  });
}
