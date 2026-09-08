import { getOpenAI } from './client';
import { ExtractedFact } from '@/types';

const EXTRACTION_SYSTEM_PROMPT = `You are a precise fact-extraction engine. Given a text chunk from a document, extract all meaningful, verifiable facts as structured JSON.

A "fact" is any claim that:
- States a specific value, figure, name, date, location, status, or relationship
- Can be verified or contradicted by another document
- Is grounded in the exact text provided

Rules:
1. Extract ONLY facts explicitly stated in the text — no inference or hallucination
2. Each fact must include a verbatim "quote" that is a direct substring of the input text
3. If you cannot find an exact quote for a fact, skip that fact
4. Be specific with entities — use the full name as it appears
5. Normalize attribute names to be consistent (e.g., "annual revenue", "net profit", "registered address", "director name", "employee count")
6. For numerical values, include units separately
7. For time-scoped facts, capture the scope (FY2023, Q1 2024, as of March 2023, etc.)
8. Confidence: 0.9 = clearly stated, 0.7 = implied, 0.5 = ambiguous

Output ONLY a JSON array of fact objects. No prose, no markdown, no explanation.`;

const EXTRACTION_USER_TEMPLATE = (chunk: string, docName: string, page: number) => `
Document: ${docName}
Page: ${page}
Chunk text:
---
${chunk}
---

Extract all facts from this chunk. Return a JSON array:
[
  {
    "entity": "full entity name",
    "attribute": "attribute name",
    "value": "raw value string",
    "unit": "unit or null",
    "time_scope": "time scope or null",
    "qualifiers": ["qualifier1", "qualifier2"],
    "quote": "exact verbatim substring from the chunk",
    "confidence": 0.9
  }
]

If no facts are found, return [].`;

export async function extractFactsFromChunk(
  chunkText: string,
  docName: string,
  page: number
): Promise<ExtractedFact[]> {
  const openai = getOpenAI();

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: EXTRACTION_USER_TEMPLATE(chunkText, docName, page) },
      ],
      temperature: 0.1,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content ?? '{"facts":[]}';
    
    // Handle both array and object wrapper responses
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.warn('Failed to parse LLM JSON response:', content.slice(0, 200));
      return [];
    }

    let facts: unknown[];
    if (Array.isArray(parsed)) {
      facts = parsed;
    } else if (parsed && typeof parsed === 'object' && 'facts' in parsed && Array.isArray((parsed as Record<string, unknown>).facts)) {
      facts = (parsed as { facts: unknown[] }).facts;
    } else {
      // Try to find any array in the object
      const values = Object.values(parsed as Record<string, unknown>);
      const arr = values.find((v) => Array.isArray(v));
      facts = Array.isArray(arr) ? arr : [];
    }

    // Validate and filter facts
    return facts
      .filter((f): f is ExtractedFact => {
        if (!f || typeof f !== 'object') return false;
        const fact = f as Partial<ExtractedFact>;
        if (!fact.entity || !fact.attribute || !fact.value || !fact.quote) return false;
        // Verify quote is actually in the chunk (grounding check)
        if (!chunkText.includes(fact.quote.trim())) {
          // Try a relaxed check — first 50 chars of quote
          const shortQuote = fact.quote.trim().slice(0, 50);
          if (!chunkText.includes(shortQuote)) {
            console.warn(`Discarding fact with unverifiable quote: "${fact.quote.slice(0, 60)}..."`);
            return false;
          }
        }
        return true;
      })
      .map((f) => ({
        entity: String(f.entity).trim(),
        attribute: String(f.attribute).trim().toLowerCase(),
        value: String(f.value).trim(),
        unit: f.unit ? String(f.unit).trim() : undefined,
        time_scope: f.time_scope ? String(f.time_scope).trim() : undefined,
        qualifiers: Array.isArray(f.qualifiers) ? f.qualifiers.map(String) : [],
        quote: String(f.quote).trim(),
        confidence: typeof f.confidence === 'number' ? Math.min(1, Math.max(0, f.confidence)) : 0.8,
      }));
  } catch (err) {
    console.error('Extraction error for page', page, ':', err);
    return [];
  }
}
