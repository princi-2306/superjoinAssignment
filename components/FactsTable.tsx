'use client';

import { useState } from 'react';
import { Fact } from '@/types';

interface FactsTableProps {
  facts: Fact[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  onPageChange: (page: number) => void;
  onSearch: (query: string) => void;
  onFilterDoc: (docId: string) => void;
  documents: Array<{ id: string; original_name: string }>;
}

export default function FactsTable({
  facts,
  total,
  page,
  pageSize,
  loading,
  onPageChange,
  onSearch,
  onFilterDoc,
  documents,
}: FactsTableProps) {
  const [selectedFact, setSelectedFact] = useState<Fact | null>(null);
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Search facts, entities, attributes..."
          className="flex-1 bg-[var(--card)] border border-[var(--card-border)] rounded-lg px-3 py-2 text-sm text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none focus:border-[var(--primary)]"
          onChange={(e) => onSearch(e.target.value)}
        />
        <select
          className="bg-[var(--card)] border border-[var(--card-border)] rounded-lg px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)]"
          onChange={(e) => onFilterDoc(e.target.value)}
        >
          <option value="">All documents</option>
          {documents.map((d) => (
            <option key={d.id} value={d.id}>
              {d.original_name}
            </option>
          ))}
        </select>
      </div>

      {/* Stats */}
      <div className="text-xs text-[var(--muted-foreground)]">
        {loading ? 'Loading...' : `${total} facts found`}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--card-border)] text-[var(--muted-foreground)] text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-3 font-medium">Entity</th>
                <th className="text-left px-4 py-3 font-medium">Attribute</th>
                <th className="text-left px-4 py-3 font-medium">Value</th>
                <th className="text-left px-4 py-3 font-medium">Scope</th>
                <th className="text-left px-4 py-3 font-medium">Source</th>
                <th className="text-left px-4 py-3 font-medium">Conf.</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-[var(--card-border)]">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-[var(--muted)] rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : facts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-[var(--muted-foreground)]">
                    No facts found
                  </td>
                </tr>
              ) : (
                facts.map((fact) => (
                  <tr
                    key={fact.id}
                    className={`border-b border-[var(--card-border)] hover:bg-[var(--muted)]/30 cursor-pointer transition-colors ${
                      selectedFact?.id === fact.id ? 'bg-[var(--primary)]/5' : ''
                    }`}
                    onClick={() => setSelectedFact(selectedFact?.id === fact.id ? null : fact)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--foreground)] max-w-[160px] truncate">
                        {fact.entity_canonical}
                      </div>
                      {fact.entity !== fact.entity_canonical && (
                        <div className="text-[10px] text-[var(--muted-foreground)] truncate max-w-[160px]">
                          raw: {fact.entity}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[var(--primary)] font-medium">{fact.attribute}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono">
                        {fact.value}
                        {fact.unit && (
                          <span className="text-[var(--muted-foreground)] ml-1 text-xs">
                            {fact.unit}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)] text-xs">
                      {fact.time_scope ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-[var(--muted-foreground)] text-xs truncate max-w-[140px]">
                        {(fact as Fact & { doc_name?: string }).doc_name ?? 'Unknown'}
                      </div>
                      <div className="text-[10px] text-[var(--muted-foreground)]">
                        p.{fact.page}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <ConfidencePip value={fact.confidence} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Evidence drawer */}
      {selectedFact && (
        <div className="card p-4 border-l-2 border-[var(--primary)] space-y-3">
          <div className="flex items-start justify-between">
            <h3 className="font-semibold text-[var(--foreground)]">Evidence</h3>
            <button
              onClick={() => setSelectedFact(null)}
              className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] text-lg leading-none"
            >
              ×
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-[var(--muted-foreground)] text-xs uppercase tracking-wide">Entity</span>
              <p className="font-medium mt-0.5">{selectedFact.entity_canonical}</p>
            </div>
            <div>
              <span className="text-[var(--muted-foreground)] text-xs uppercase tracking-wide">Attribute</span>
              <p className="font-medium mt-0.5 text-[var(--primary)]">{selectedFact.attribute}</p>
            </div>
            <div>
              <span className="text-[var(--muted-foreground)] text-xs uppercase tracking-wide">Value</span>
              <p className="font-mono mt-0.5">
                {selectedFact.value}
                {selectedFact.unit && <span className="text-[var(--muted-foreground)] ml-1">{selectedFact.unit}</span>}
              </p>
            </div>
            <div>
              <span className="text-[var(--muted-foreground)] text-xs uppercase tracking-wide">Time Scope</span>
              <p className="mt-0.5">{selectedFact.time_scope ?? 'Not specified'}</p>
            </div>
          </div>
          {selectedFact.qualifiers?.length > 0 && (
            <div>
              <span className="text-[var(--muted-foreground)] text-xs uppercase tracking-wide">Qualifiers</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {selectedFact.qualifiers.map((q, i) => (
                  <span key={i} className="badge bg-[var(--muted)] text-[var(--muted-foreground)]">
                    {q}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <span className="text-[var(--muted-foreground)] text-xs uppercase tracking-wide">
              Source Quote · {(selectedFact as Fact & { doc_name?: string }).doc_name}, page {selectedFact.page}
            </span>
            <blockquote className="mt-1.5 bg-[var(--muted)]/40 rounded-lg p-3 text-sm italic text-[var(--foreground)] border-l-2 border-[var(--primary)]/40">
              &ldquo;{selectedFact.quote}&rdquo;
            </blockquote>
          </div>
        </div>
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

function ConfidencePip({ value }: { value: number }) {
  const color =
    value >= 0.8 ? 'bg-green-500' : value >= 0.6 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-xs text-[var(--muted-foreground)]">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}
