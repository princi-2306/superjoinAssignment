"use client";

import { useState } from "react";

interface RelationshipRow {
  id: string;
  relation: "corroborates" | "contradicts" | "reconciled";
  explanation: string;
  confidence: number;
  reconciliation_context?: string | null;
  entity_a: string; attribute_a: string; value_a: string; unit_a?: string | null;
  time_scope_a?: string | null; qualifiers_a: string[]; quote_a: string;
  page_a: number; doc_name_a: string;
  entity_b: string; attribute_b: string; value_b: string; unit_b?: string | null;
  time_scope_b?: string | null; qualifiers_b: string[]; quote_b: string;
  page_b: number; doc_name_b: string;
}

interface FourCasesPanelProps {
  relationships: RelationshipRow[];
  loading: boolean;
}

const CASES = [
  {
    key: "corroborates" as const,
    number: "01",
    title: "Corroboration",
    subtitle: "Same fact, expressed differently across documents",
    icon: "✓",
    colorText: "text-green-400",
    colorBg: "bg-green-500/10",
    colorBorder: "border-green-500/25",
    description:
      "A fact confirmed across two or more documents, even when phrasing, units, or terminology differ. The system normalises values and resolves synonyms to detect these.",
  },
  {
    key: "contradicts" as const,
    number: "02",
    title: "Contradiction",
    subtitle: "Genuinely incompatible claims about the same entity",
    icon: "✗",
    colorText: "text-red-400",
    colorBg: "bg-red-500/10",
    colorBorder: "border-red-500/25",
    description:
      "Two facts that cannot both be true with no contextual explanation available — e.g. a director listed as active in one document but resigned in another.",
  },
  {
    key: "reconciled" as const,
    number: "03",
    title: "Reconciled",
    subtitle: "Apparent contradiction explained by context",
    icon: "⇄",
    colorText: "text-blue-400",
    colorBg: "bg-blue-500/10",
    colorBorder: "border-blue-500/25",
    description:
      "Facts that look contradictory on the surface but are resolved by context — different time periods, tax treatment, geographic scope, or unit definitions.",
  },
  {
    key: "_failure" as const,
    number: "04",
    title: "Extraction Failure",
    subtitle: "A failure found and how it was handled",
    icon: "⚠",
    colorText: "text-yellow-400",
    colorBg: "bg-yellow-500/10",
    colorBorder: "border-yellow-500/25",
    description:
      "The most common failure mode is dense financial tables where the LLM misreads which value belongs to which column header. The grounding check (every fact must include a verbatim quote that exists in the source chunk) catches most of these — if the LLM cannot produce a real quote, the fact is discarded. The fix for remaining table misreads is a dedicated table-extraction pass (e.g. Camelot) that resolves column headers before feeding cell values to the LLM.",
  },
];

export default function FourCasesPanel({ relationships, loading }: FourCasesPanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  // Pick the best example for each case type (highest confidence)
  const getBest = (rel: "corroborates" | "contradicts" | "reconciled") =>
    relationships
      .filter((r) => r.relation === rel)
      .sort((a, b) => b.confidence - a.confidence)[0] ?? null;

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4">
        {CASES.map((c) => (
          <div key={c.key} className="card p-5 animate-pulse space-y-3">
            <div className="h-4 rounded" style={{ background: "var(--color-muted)", width: "40%" }} />
            <div className="h-3 rounded" style={{ background: "var(--color-muted)", width: "70%" }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold" style={{ color: "var(--color-fg)" }}>The Four Required Cases</h2>
        <p className="text-xs mt-0.5" style={{ color: "var(--color-muted-fg)" }}>
          Best examples automatically selected from your knowledge base · Click a card to see source evidence
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {CASES.map((c) => {
          const example = c.key !== "_failure" ? getBest(c.key) : null;
          const isOpen  = expanded === c.key;

          return (
            <div key={c.key}
              className={`card border overflow-hidden transition-all ${c.colorBorder}`}>
              {/* Header */}
              <button
                className="w-full text-left p-4 flex items-start gap-3 hover:opacity-90 transition-opacity"
                onClick={() => setExpanded(isOpen ? null : c.key)}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${c.colorBg} ${c.colorText}`}>
                  {c.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono" style={{ color: "var(--color-muted-fg)" }}>{c.number}</span>
                    <span className={`font-semibold text-sm ${c.colorText}`}>{c.title}</span>
                    {example && (
                      <span className="text-xs px-1.5 py-0.5 rounded"
                        style={{ background: "var(--color-muted)", color: "var(--color-muted-fg)" }}>
                        {Math.round(example.confidence * 100)}% conf.
                      </span>
                    )}
                    {!example && c.key !== "_failure" && (
                      <span className="text-xs" style={{ color: "var(--color-muted-fg)" }}>
                        — upload more documents
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-muted-fg)" }}>
                    {c.subtitle}
                  </p>
                </div>
                <span className={`text-xs flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  style={{ color: "var(--color-muted-fg)" }}>▾</span>
              </button>

              {/* Expanded body */}
              {isOpen && (
                <div className={`border-t p-4 space-y-4 ${c.colorBorder} ${c.colorBg}/30`}>
                  <p className="text-sm" style={{ color: "var(--color-muted-fg)" }}>{c.description}</p>

                  {/* Failure case — static explanation */}
                  {c.key === "_failure" && (
                    <div className="space-y-3">
                      <div className="rounded-lg p-3 space-y-2"
                        style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                        <p className="text-xs font-medium" style={{ color: "var(--color-fg)" }}>
                          What was caught
                        </p>
                        <p className="text-xs" style={{ color: "var(--color-muted-fg)" }}>
                          In dense financial tables, the LLM occasionally misattributes a value to the wrong column header (e.g. reading &quot;headcount cost in USD thousands&quot; as employee count). The grounding check discards facts whose quoted text cannot be found verbatim in the source chunk — this catches fabricated quotes but not all table misreads.
                        </p>
                      </div>
                      <div className="rounded-lg p-3 space-y-2"
                        style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                        <p className="text-xs font-medium" style={{ color: "var(--color-fg)" }}>
                          What would fix it
                        </p>
                        <p className="text-xs" style={{ color: "var(--color-muted-fg)" }}>
                          A dedicated table-extraction pass using Camelot or a table transformer model that resolves column headers separately before feeding row values to the LLM as structured data rather than prose.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Live example from knowledge base */}
                  {example && c.key !== "_failure" && (
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs uppercase tracking-wide mb-1.5 font-medium"
                          style={{ color: "var(--color-muted-fg)" }}>System Reasoning</p>
                        <p className="text-sm" style={{ color: "var(--color-fg)" }}>{example.explanation}</p>
                        {example.reconciliation_context && (
                          <div className="mt-2 rounded-lg p-3"
                            style={{ background: "color-mix(in srgb,#3b82f6 10%,transparent)", border: "1px solid color-mix(in srgb,#3b82f6 25%,transparent)" }}>
                            <p className="text-xs font-medium text-blue-400 mb-1">Reconciliation Context</p>
                            <p className="text-xs" style={{ color: "var(--color-fg)" }}>
                              {example.reconciliation_context}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <EvidenceCard label="Source A" example={example} side="a" />
                        <EvidenceCard label="Source B" example={example} side="b" />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EvidenceCard({ label, example, side }: {
  label: string;
  example: RelationshipRow;
  side: "a" | "b";
}) {
  const entity    = side === "a" ? example.entity_a    : example.entity_b;
  const attribute = side === "a" ? example.attribute_a : example.attribute_b;
  const value     = side === "a" ? example.value_a     : example.value_b;
  const unit      = side === "a" ? example.unit_a      : example.unit_b;
  const timeScope = side === "a" ? example.time_scope_a : example.time_scope_b;
  const qualifiers = side === "a" ? (example.qualifiers_a ?? []) : (example.qualifiers_b ?? []);
  const quote     = side === "a" ? example.quote_a     : example.quote_b;
  const page      = side === "a" ? example.page_a      : example.page_b;
  const docName   = side === "a" ? example.doc_name_a  : example.doc_name_b;

  return (
    <div className="rounded-lg p-3 space-y-2 text-xs"
      style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
      <p className="font-medium uppercase tracking-wide" style={{ color: "var(--color-muted-fg)" }}>
        {label}
      </p>
      <p className="font-medium" style={{ color: "var(--color-fg)" }}>{entity}</p>
      <p style={{ color: "var(--color-primary)" }}>{attribute}</p>
      <p className="font-mono">
        {value}{unit && <span style={{ color: "var(--color-muted-fg)" }}> {unit}</span>}
      </p>
      {timeScope && <p style={{ color: "var(--color-muted-fg)" }}>📅 {timeScope}</p>}
      {qualifiers.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {qualifiers.map((q, i) => (
            <span key={i} className="px-1.5 py-0.5 rounded text-[10px]"
              style={{ background: "var(--color-muted)", color: "var(--color-muted-fg)" }}>
              {q}
            </span>
          ))}
        </div>
      )}
      <blockquote className="italic rounded p-2"
        style={{
          background: "var(--color-muted)",
          color: "var(--color-muted-fg)",
          borderLeft: "2px solid var(--color-primary)",
        }}>
        &ldquo;{quote.length > 130 ? quote.slice(0, 130) + "…" : quote}&rdquo;
      </blockquote>
      <p style={{ color: "var(--color-muted-fg)" }}>📄 {docName}, p.{page}</p>
    </div>
  );
}
