import { getGemini } from "./client";
import { ExtractedFact } from "@/types";

const EXTRACTION_PROMPT = (chunk: string, docName: string, page: number) => `
You are a precise fact-extraction engine. Given a text chunk from a document, extract all meaningful, verifiable facts as structured JSON.

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

Document: ${docName}
Page: ${page}
Chunk text:
---
${chunk}
---

Return ONLY a valid JSON object in this exact format (no markdown, no prose):
{
  "facts": [
    {
      "entity": "full entity name",
      "attribute": "attribute name",
      "value": "raw value string",
      "unit": "unit or null",
      "time_scope": "time scope or null",
      "qualifiers": ["qualifier1"],
      "quote": "exact verbatim substring from the chunk",
      "confidence": 0.9
    }
  ]
}

If no facts are found, return { "facts": [] }`.trim();

export async function extractFactsFromChunk(
  chunkText: string,
  docName: string,
  page: number
): Promise<ExtractedFact[]> {
  const gemini = getGemini();

  try {
    console.log(`[llm/extract] Extracting facts from doc="${docName}", page=${page}, chunk_len=${chunkText.length}`);
    const model = gemini.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent(
      EXTRACTION_PROMPT(chunkText, docName, page)
    );
    const text = result.response.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.warn("[llm/extract] Failed to parse Gemini JSON response:", text.slice(0, 200));
      return [];
    }

    // Unwrap { facts: [...] } or bare array
    let facts: unknown[];
    if (Array.isArray(parsed)) {
      facts = parsed;
    } else if (
      parsed &&
      typeof parsed === "object" &&
      "facts" in parsed &&
      Array.isArray((parsed as Record<string, unknown>).facts)
    ) {
      facts = (parsed as { facts: unknown[] }).facts;
    } else {
      const values = Object.values(parsed as Record<string, unknown>);
      const arr = values.find((v) => Array.isArray(v));
      facts = Array.isArray(arr) ? arr : [];
    }

    // Validate + grounding check
    const extracted = facts
      .filter((f): f is ExtractedFact => {
        if (!f || typeof f !== "object") return false;
        const fact = f as Partial<ExtractedFact>;
        if (!fact.entity || !fact.attribute || !fact.value || !fact.quote) return false;
        // Grounding: quote must be a substring of the source chunk
        if (!chunkText.includes(fact.quote.trim())) {
          const shortQuote = fact.quote.trim().slice(0, 50);
          if (!chunkText.includes(shortQuote)) {
            console.warn(`Discarding ungrounded quote: "${fact.quote.slice(0, 60)}..."`);
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
        confidence:
          typeof f.confidence === "number"
            ? Math.min(1, Math.max(0, f.confidence))
            : 0.8,
      }));

    extracted.forEach((ef) => {
      console.log(`[llm/extract] Parsed fact: entity="${ef.entity}", attribute="${ef.attribute}", quote_len=${ef.quote.length}`);
    });

    return extracted;
  } catch (err) {
    console.error("[llm/extract] Extraction error for page", page, ":", err);
    return [];
  }
}
