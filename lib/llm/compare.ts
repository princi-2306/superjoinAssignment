import { getGemini } from "./client";
import { Fact, ComparisonResult, RelationType } from "@/types";

const COMPARISON_PROMPT = (factA: Fact, factB: Fact) => `
You are a fact-comparison engine. Given two facts extracted from different documents, determine their relationship.

Relationships:
- "corroborates": Both facts make the same or very similar claim. Values may be expressed differently but refer to the same underlying truth.
- "contradicts": Facts make genuinely incompatible claims about the same entity/attribute with no contextual explanation.
- "reconciled": Facts appear to contradict but can be explained by context — different time periods, units, scopes (quarterly vs annual, gross vs net), definitions, or geographic scope.
- "unrelated": Facts are about different enough things that no meaningful comparison applies.

For "reconciled", you MUST explain exactly what contextual difference resolves the apparent contradiction.
For "contradicts", state why no reconciliation is possible.
For "corroborates", note how the expressions differ (if at all).

Fact A:
- Entity: ${factA.entity_canonical}
- Attribute: ${factA.attribute}
- Value: ${factA.value}${factA.unit ? ` ${factA.unit}` : ""}
- Time scope: ${factA.time_scope ?? "not specified"}
- Qualifiers: ${factA.qualifiers.join(", ") || "none"}
- Quote: "${factA.quote}"
- Source: ${factA.source?.doc_name ?? "doc " + factA.doc_id}, page ${factA.page}

Fact B:
- Entity: ${factB.entity_canonical}
- Attribute: ${factB.attribute}
- Value: ${factB.value}${factB.unit ? ` ${factB.unit}` : ""}
- Time scope: ${factB.time_scope ?? "not specified"}
- Qualifiers: ${factB.qualifiers.join(", ") || "none"}
- Quote: "${factB.quote}"
- Source: ${factB.source?.doc_name ?? "doc " + factB.doc_id}, page ${factB.page}

Return ONLY a valid JSON object (no markdown, no prose):
{
  "relation": "corroborates" | "contradicts" | "reconciled" | "unrelated",
  "explanation": "clear explanation of why",
  "confidence": 0.0-1.0,
  "reconciliation_context": "only for reconciled — what context resolves the conflict, otherwise null"
}`.trim();

export async function compareFacts(
  factA: Fact,
  factB: Fact
): Promise<ComparisonResult> {
  const gemini = getGemini();

  try {
    const model = gemini.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 512,
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent(COMPARISON_PROMPT(factA, factB));
    const text = result.response.text();
    const parsed = JSON.parse(text) as Partial<ComparisonResult>;

    const validRelations: RelationType[] = [
      "corroborates",
      "contradicts",
      "reconciled",
      "unrelated",
    ];
    const relation = validRelations.includes(parsed.relation as RelationType)
      ? (parsed.relation as RelationType)
      : "unrelated";

    return {
      relation,
      explanation: parsed.explanation ?? "No explanation provided",
      confidence:
        typeof parsed.confidence === "number"
          ? Math.min(1, Math.max(0, parsed.confidence))
          : 0.7,
      reconciliation_context: parsed.reconciliation_context,
    };
  } catch (err) {
    console.error("Comparison error:", err);
    return {
      relation: "unrelated",
      explanation: "Comparison failed due to an internal error",
      confidence: 0.1,
    };
  }
}
