import { Chunk } from '@/types';

// We use dynamic import so pdf-parse doesn't break Next.js module resolution
export async function parsePdf(buffer: Buffer): Promise<{ pages: string[]; totalPages: number }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse');

  const pageTexts: string[] = [];

  console.log('[parse] parsePdf: starting pdf-parse');
  // pdf-parse gives us the full text; we also want per-page breakdown
  const data = await pdfParse(buffer, {
    // Render page-by-page
    pagerender: (pageData: { getTextContent: () => Promise<{ items: Array<{ str: string; transform: number[] }> }> }) => {
      return pageData.getTextContent().then((content: { items: Array<{ str: string; transform: number[] }> }) => {
        // Reconstruct text preserving line structure via y-position grouping
        const items = content.items;
        
        // Group text items by approximate y-position (line)
        const lines: Map<number, string[]> = new Map();
        for (const item of items) {
          const y = Math.round(item.transform[5]); // y-position
          if (!lines.has(y)) lines.set(y, []);
          lines.get(y)!.push(item.str);
        }

        // Sort by descending y (top to bottom) and join
        const sortedY = Array.from(lines.keys()).sort((a, b) => b - a);
        const pageText = sortedY
          .map((y) => lines.get(y)!.join(' ').trim())
          .filter(Boolean)
          .join('\n');

        pageTexts.push(pageText);
        console.log(`[parse] page ${pageTexts.length} extracted, length=${pageText.length}`);
        return pageText;
      });
    },
  });

  // If custom renderer didn't populate (can happen with some PDFs), fall back to splitting by form feeds
  if (pageTexts.length === 0 && data.text) {
    console.log('[parse] fallback: splitting data.text into pages');
    const split = data.text.split(/\f|\n{5,}/);
    pageTexts.push(...split.filter(Boolean));
    console.log('[parse] fallback produced', pageTexts.length, 'pages');
  }

  return {
    pages: pageTexts,
    totalPages: data.numpages ?? pageTexts.length,
  };
}

/**
 * Split a page's text into overlapping chunks of ~300 tokens (approx 1200 chars),
 * tracking character offsets relative to the page start.
 */
export function chunkPage(
  pageText: string,
  docId: string,
  page: number,
  chunkSize = 1200,
  overlap = 200
): Chunk[] {
  const chunks: Chunk[] = [];

  if (pageText.length <= chunkSize) {
    chunks.push({
      doc_id: docId,
      page,
      chunk_index: 0,
      text: pageText,
      char_start: 0,
      char_end: pageText.length,
    });
    return chunks;
  }

  let start = 0;
  let index = 0;

  while (start < pageText.length) {
    let end = Math.min(start + chunkSize, pageText.length);

    // Try to end at a sentence boundary
    if (end < pageText.length) {
      const boundary = pageText.lastIndexOf('. ', end);
      if (boundary > start + chunkSize / 2) {
        end = boundary + 1;
      }
    }

    chunks.push({
      doc_id: docId,
      page,
      chunk_index: index++,
      text: pageText.slice(start, end).trim(),
      char_start: start,
      char_end: end,
    });

    start = end - overlap;
    if (start >= pageText.length) break;
  }

  return chunks;
}
