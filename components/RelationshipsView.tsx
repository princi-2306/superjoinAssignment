'use client';

import { useState } from 'react';

interface RelationshipRow {
  id: string;
  fact_id_a: string;
  fact_id_b: string;
  relation: 'corroborates' | 'contradicts' | 'reconciled';
  explanation: string;
  confidence: number;
  reconciliation_context?: string | null;
  // Fact A
  entity_a: string;
  entity_canonical_a: string;
  attribute_a: string;
  value_a: string;
  unit_a?: string | null;
  time_scope_a?: string | null;
  qualifiers_a: string[];
  quote_a: string;
  page_a: number;
  doc_name_a: string;
  doc_id_a: string;
  // Fact B
  entity_b: string;
  entity_canonical_b: string;
  attribute_b: string;
  value_b: string;
  unit_b?: string | null;
  time_scope_b?: string | null;
  qualifiers_b: string[];
  quote_b: string;
  page_b: number;
  doc_name_b: string;
  doc_id_b: string;
}

interface RelationshipsViewProps {
  relationships: RelationshipRow[];
  total: number;
  summary: { corroborates: number; contradicts: number; reconciled: number };
  loading: boolean;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onFilterRelation: (r: string) => void;
}

const RELATION_CONFIG = {
  corroborates: {
    label: 'Corroborates',
    icon: '✓',
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    border: 'border-green-500/20',
    badge: 'badge-corroborates',
  },
  contradicts: {
    label: 'Contradicts',
    icon: '✗',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    badge: 'badge-contradicts',
  },
  reconciled: {
    label: 'Reconciled',
    icon: '⇄',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    badge: 'badge-reconciled',
  },
};

export default function RelationshipsView({
  relationships,
  total,
  summary,
  loading,
  page,
  pageSize,
  onPageChange,
  onFilterRelation,
}: RelationshipsViewProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {(Object.keys(RELATION_CONFIG) as Array<keyof typeof RELATION_CONFIG>).map((key) => {
          const cfg = RELATION_CONFIG[key];
          return (
            <button
              key={key}
              onClick={() => onFilterRelation(key)}
              className={`card p-4 text-left hover:border-[var(--primary)]/40 transition-colors`}
            >
              <div className={`text-2xl font-bold ${cfg.color}`}>
                {summary[key] ?? 0}
              </div>
              <div className="text-xs text-[var(--muted-foreground)] mt-0.5 flex items-center gap-1">
                <span className={cfg.color}>{cfg.icon}</span>
                {cfg.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filter row */}
      <div className="flex gap-2">
        <button
          onClick={() => onFilterRelation('')}
          className="px-3 py-1.5 rounded-lg border border-[var(--card-border)] text-sm text-[var(--muted-foreground)] hover:border-[var(--primary)] transition-colors"
        >
          All ({total})
        </button>
        {(Object.keys(RELATION_CONFIG) as Array<keyof typeof RELATION_CONFIG>).map((key) => (
          <button
            key={key}
            onClick={() => onFilterRelation(key)}
            className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${RELATION_CONFIG[key].border} ${RELATION_CONFIG[key].color} hover:${RELATION_CONFIG[key].bg}`}
          >
            {RELATION_CONFIG[key].label} ({summary[key] ?? 0})
          </button>
        ))}
      </div>

      {/* Relationship cards */}
      {loading ? (
        Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card p-4 animate-pulse space-y-2">
            <div className="h-4 bg-[var(--muted)] rounded w-1/3" />
            <div className="h-3 bg-[var(--muted)] rounded w-2/3" />
          </div>
        ))
      ) : relationships.length === 0 ? (
        <div className="text-center py-12 text-[var(--muted-foreground)]">
          <div className="text-3xl mb-2">🔗</div>
          <p>No relationships found yet.</p>
          <p className="text-xs mt-1">Upload multiple documents to discover connections.</p>
        </div>
      ) : (
        relationships.map((rel) => {
          const cfg = RELATION_CONFIG[rel.relation] ?? RELATION_CONFIG.corroborates;
          const isExpanded = expanded === rel.id;

          return (
            <div
              key={rel.id}
              className={`card border overflow-hidden ${cfg.border} transition-all`}
            >
              {/* Header */}
              <button
                className="w-full text-left p-4 hover:bg-[var(--muted)]/20 transition-colors"
                onClick={() => setExpanded(isExpanded ? null : rel.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded-full ${cfg.bg} flex items-center justify-center text-sm flex-shrink-0 font-bold ${cfg.color}`}>
                      {cfg.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`badge ${cfg.bg} ${cfg.color} ${cfg.border} border`}>
                          {cfg.label}
                        </span>
                        <span className="text-[var(--foreground)] font-medium">
                          {rel.entity_canonical_a || rel.entity_a}
                        </span>
                        <span className="text-[var(--muted-foreground)]">·</span>
                        <span className="text-[var(--primary)]">{rel.attribute_a}</span>
                      </div>
                      <p className="text-sm text-[var(--muted-foreground)] mt-1 line-clamp-2">
                        {rel.explanation}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {Math.round(rel.confidence * 100)}% conf.
                    </span>
                    <span className={`text-[var(--muted-foreground)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                      ▾
                    </span>
                  </div>
                </div>
              </button>

              {/* Expanded evidence */}
              {isExpanded && (
                <div className={`border-t border-[var(--card-border)] p-4 ${cfg.bg}/30 space-y-4`}>
                  {/* Explanation */}
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)] mb-1">
                      Reasoning
                    </p>
                    <p className="text-sm text-[var(--foreground)]">{rel.explanation}</p>
                    {rel.reconciliation_context && (
                      <div className="mt-2 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                        <p className="text-xs uppercase tracking-wide text-blue-400 mb-1">
                          Reconciliation Context
                        </p>
                        <p className="text-sm text-[var(--foreground)]">{rel.reconciliation_context}</p>
                      </div>
                    )}
                  </div>

                  {/* Side by side facts */}
                  <div className="grid grid-cols-2 gap-3">
                    <FactCard
                      entity={rel.entity_canonical_a || rel.entity_a}
                      attribute={rel.attribute_a}
                      value={rel.value_a}
                      unit={rel.unit_a}
                      timeScope={rel.time_scope_a}
                      qualifiers={rel.qualifiers_a}
                      quote={rel.quote_a}
                      page={rel.page_a}
                      docName={rel.doc_name_a}
                      label="Source A"
                    />
                    <FactCard
                      entity={rel.entity_canonical_b || rel.entity_b}
                      attribute={rel.attribute_b}
                      value={rel.value_b}
                      unit={rel.unit_b}
                      timeScope={rel.time_scope_b}
                      qualifiers={rel.qualifiers_b}
                      quote={rel.quote_b}
                      page={rel.page_b}
                      docName={rel.doc_name_b}
                      label="Source B"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--muted-foreground)]">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="px-3 py-1.5 rounded-lg border border-[var(--card-border)] disabled:opacity-40 hover:border-[var(--primary)] transition-colors"
            >
              ← Prev
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="px-3 py-1.5 rounded-lg border border-[var(--card-border)] disabled:opacity-40 hover:border-[var(--primary)] transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FactCard({
  entity,
  attribute,
  value,
  unit,
  timeScope,
  qualifiers,
  quote,
  page,
  docName,
  label,
}: {
  entity: string;
  attribute: string;
  value: string;
  unit?: string | null;
  timeScope?: string | null;
  qualifiers: string[] | null;
  quote: string;
  page: number;
  docName: string;
  label: string;
}) {
  const safeQualifiers = Array.isArray(qualifiers) ? qualifiers : [];
  
  return (
    <div className="bg-[var(--card)] rounded-lg border border-[var(--card-border)] p-3 space-y-2">
      <div className="text-xs uppercase tracking-wide text-[var(--muted-foreground)] font-medium">
        {label}
      </div>
      <div>
        <div className="font-medium text-sm text-[var(--foreground)]">{entity}</div>
        <div className="text-xs text-[var(--primary)]">{attribute}</div>
      </div>
      <div className="font-mono text-sm">
        {value}
        {unit && <span className="text-[var(--muted-foreground)] ml-1 text-xs">{unit}</span>}
      </div>
      {timeScope && (
        <div className="text-xs text-[var(--muted-foreground)]">📅 {timeScope}</div>
      )}
      {safeQualifiers.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {safeQualifiers.map((q, i) => (
            <span key={i} className="badge bg-[var(--muted)] text-[var(--muted-foreground)] text-[10px]">
              {q}
            </span>
          ))}
        </div>
      )}
      <blockquote className="text-xs italic text-[var(--muted-foreground)] bg-[var(--muted)]/40 rounded p-2 border-l border-[var(--primary)]/40">
        &ldquo;{quote.length > 150 ? quote.slice(0, 150) + '…' : quote}&rdquo;
      </blockquote>
      <div className="text-[10px] text-[var(--muted-foreground)]">
        📄 {docName}, p.{page}
      </div>
    </div>
  );
}
