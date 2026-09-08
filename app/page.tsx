'use client';

import { useState, useEffect, useCallback } from 'react';
import UploadZone from '@/components/UploadZone';
import DocumentList from '@/components/DocumentList';
import FactsTable from '@/components/FactsTable';
import RelationshipsView from '@/components/RelationshipsView';
import { Document, Fact } from '@/types';

type Tab = 'upload' | 'facts' | 'relationships';

interface RelationshipRow {
  id: string;
  fact_id_a: string;
  fact_id_b: string;
  relation: 'corroborates' | 'contradicts' | 'reconciled';
  explanation: string;
  confidence: number;
  reconciliation_context?: string;
  entity_a: string;
  entity_canonical_a: string;
  attribute_a: string;
  value_a: string;
  unit_a?: string;
  time_scope_a?: string;
  qualifiers_a: string[];
  quote_a: string;
  page_a: number;
  doc_name_a: string;
  doc_id_a: string;
  entity_b: string;
  entity_canonical_b: string;
  attribute_b: string;
  value_b: string;
  unit_b?: string;
  time_scope_b?: string;
  qualifiers_b: string[];
  quote_b: string;
  page_b: number;
  doc_name_b: string;
  doc_id_b: string;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('upload');

  // Documents
  const [documents, setDocuments] = useState<Document[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);

  // Facts
  const [facts, setFacts] = useState<Fact[]>([]);
  const [factsTotal, setFactsTotal] = useState(0);
  const [factsPage, setFactsPage] = useState(1);
  const [factsLoading, setFactsLoading] = useState(false);
  const [factsSearch, setFactsSearch] = useState('');
  const [factsDocFilter, setFactsDocFilter] = useState('');

  // Relationships
  const [relationships, setRelationships] = useState<RelationshipRow[]>([]);
  const [relTotal, setRelTotal] = useState(0);
  const [relSummary, setRelSummary] = useState({ corroborates: 0, contradicts: 0, reconciled: 0 });
  const [relPage, setRelPage] = useState(1);
  const [relLoading, setRelLoading] = useState(false);
  const [relFilter, setRelFilter] = useState('');

  const PAGE_SIZE = 20;

  // ── Fetch documents ─────────────────────────────────────────────────────────
  const fetchDocuments = useCallback(async () => {
    setDocsLoading(true);
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      setDocuments(data.documents ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setDocsLoading(false);
    }
  }, []);

  // ── Fetch facts ─────────────────────────────────────────────────────────────
  const fetchFacts = useCallback(async () => {
    setFactsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(factsPage),
        page_size: String(PAGE_SIZE),
      });
      if (factsSearch) params.set('search', factsSearch);
      if (factsDocFilter) params.set('doc_id', factsDocFilter);

      const res = await fetch(`/api/facts?${params}`);
      const data = await res.json();
      setFacts(data.facts ?? []);
      setFactsTotal(data.total ?? 0);
    } catch (e) {
      console.error(e);
    } finally {
      setFactsLoading(false);
    }
  }, [factsPage, factsSearch, factsDocFilter]);

  // ── Fetch relationships ─────────────────────────────────────────────────────
  const fetchRelationships = useCallback(async () => {
    setRelLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(relPage),
        page_size: String(PAGE_SIZE),
      });
      if (relFilter) params.set('relation', relFilter);

      const res = await fetch(`/api/relationships?${params}`);
      const data = await res.json();
      setRelationships(data.relationships ?? []);
      setRelTotal(data.total ?? 0);
      setRelSummary(data.summary ?? { corroborates: 0, contradicts: 0, reconciled: 0 });
    } catch (e) {
      console.error(e);
    } finally {
      setRelLoading(false);
    }
  }, [relPage, relFilter]);

  // Initial load
  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  useEffect(() => {
    if (activeTab === 'facts') fetchFacts();
  }, [activeTab, fetchFacts]);

  useEffect(() => {
    if (activeTab === 'relationships') fetchRelationships();
  }, [activeTab, fetchRelationships]);

  // ── Search debounce ─────────────────────────────────────────────────────────
  const handleSearch = useCallback((q: string) => {
    setFactsPage(1);
    setFactsSearch(q);
  }, []);

  const handleFilterDoc = useCallback((docId: string) => {
    setFactsPage(1);
    setFactsDocFilter(docId);
  }, []);

  const handleFilterRelation = useCallback((r: string) => {
    setRelPage(1);
    setRelFilter(r);
  }, []);

  const handleUploadComplete = useCallback(() => {
    fetchDocuments();
    // Auto-refresh facts/relationships if on those tabs
    if (activeTab === 'facts') fetchFacts();
    if (activeTab === 'relationships') fetchRelationships();
  }, [fetchDocuments, fetchFacts, fetchRelationships, activeTab]);

  // Global stats
  const completedDocs = documents.filter((d) => d.status === 'completed').length;
  const totalFacts = documents.reduce((sum, d) => sum + (d.fact_count ?? 0), 0);

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Header */}
      <header className="border-b border-[var(--card-border)] bg-[var(--card)]/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[var(--primary)] flex items-center justify-center text-white font-bold text-sm">
                F
              </div>
              <div>
                <h1 className="font-semibold text-[var(--foreground)]">Fact Knowledge Layer</h1>
                <p className="text-[10px] text-[var(--muted-foreground)]">
                  Extract · Link · Compare
                </p>
              </div>
            </div>

            {/* Global stats */}
            <div className="flex items-center gap-4 text-sm">
              <StatPill label="Documents" value={completedDocs} />
              <StatPill label="Facts" value={totalFacts} />
              <StatPill label="Corroborations" value={relSummary.corroborates} color="text-green-400" />
              <StatPill label="Contradictions" value={relSummary.contradicts} color="text-red-400" />
              <StatPill label="Reconciled" value={relSummary.reconciled} color="text-blue-400" />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-[var(--card)] rounded-xl border border-[var(--card-border)] w-fit">
          {([
            { key: 'upload', label: '📤 Upload', desc: 'Add Documents' },
            { key: 'facts', label: '🔍 Facts', desc: `${totalFacts} extracted` },
            { key: 'relationships', label: '🔗 Relationships', desc: `${relTotal} found` },
          ] as Array<{ key: Tab; label: string; desc: string }>).map(({ key, label, desc }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === key
                  ? 'bg-[var(--primary)] text-white shadow-sm'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              {label}
              <span className={`ml-2 text-[10px] ${activeTab === key ? 'text-white/70' : 'text-[var(--muted-foreground)]'}`}>
                {desc}
              </span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'upload' && (
          <div className="space-y-6">
            <div className="card p-6 space-y-4">
              <div>
                <h2 className="font-semibold text-[var(--foreground)]">Upload Documents</h2>
                <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
                  PDFs are parsed, chunked, and facts extracted via LLM with full provenance tracking.
                </p>
              </div>
              <UploadZone onUploadComplete={handleUploadComplete} />
            </div>

            <div className="card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-[var(--foreground)]">Knowledge Base</h2>
                <button
                  onClick={fetchDocuments}
                  className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] flex items-center gap-1"
                >
                  ↻ Refresh
                </button>
              </div>
              <DocumentList documents={documents} loading={docsLoading} />
            </div>

            {/* Pipeline explainer */}
            <div className="card p-6">
              <h2 className="font-semibold text-[var(--foreground)] mb-4">How it works</h2>
              <div className="grid grid-cols-4 gap-4">
                {[
                  {
                    step: '01',
                    icon: '📄',
                    title: 'Parse & Chunk',
                    desc: 'PDF pages extracted with character offsets for grounding. Split into ~1200-char overlapping chunks.',
                  },
                  {
                    step: '02',
                    icon: '🤖',
                    title: 'LLM Extraction',
                    desc: 'GPT-4o-mini extracts atomic facts per chunk. Each fact must include a verbatim quote — no hallucination allowed.',
                  },
                  {
                    step: '03',
                    icon: '🔧',
                    title: 'Normalize',
                    desc: 'Entity names canonicalized via bigram similarity. Numeric values parsed to comparable form (units, multipliers).',
                  },
                  {
                    step: '04',
                    icon: '⚖️',
                    title: 'Compare',
                    desc: 'New facts matched against existing ones by entity + attribute. LLM classifies: corroborates, contradicts, or reconciled.',
                  },
                ].map((item) => (
                  <div key={item.step} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-[var(--primary)]">{item.step}</span>
                      <span className="text-lg">{item.icon}</span>
                    </div>
                    <h3 className="text-sm font-medium text-[var(--foreground)]">{item.title}</h3>
                    <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'facts' && (
          <FactsTable
            facts={facts}
            total={factsTotal}
            page={factsPage}
            pageSize={PAGE_SIZE}
            loading={factsLoading}
            onPageChange={setFactsPage}
            onSearch={handleSearch}
            onFilterDoc={handleFilterDoc}
            documents={documents}
          />
        )}

        {activeTab === 'relationships' && (
          <RelationshipsView
            relationships={relationships}
            total={relTotal}
            summary={relSummary}
            loading={relLoading}
            page={relPage}
            pageSize={PAGE_SIZE}
            onPageChange={setRelPage}
            onFilterRelation={handleFilterRelation}
          />
        )}
      </main>
    </div>
  );
}

function StatPill({
  label,
  value,
  color = 'text-[var(--foreground)]',
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="text-center">
      <div className={`font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-[var(--muted-foreground)]">{label}</div>
    </div>
  );
}
