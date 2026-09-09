"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import UploadZone from "@/components/UploadZone";
import DocumentList from "@/components/DocumentList";
import FactsTable from "@/components/FactsTable";
import RelationshipsView from "@/components/RelationshipsView";
import FourCasesPanel from "@/components/FourCasesPanel";
import api from "@/lib/api/axios";
import { Document, Fact } from "@/types";

type Tab = "upload" | "facts" | "relationships" | "cases";

interface RelationshipRow {
  id: string;
  fact_id_a: string; fact_id_b: string;
  relation: "corroborates" | "contradicts" | "reconciled";
  explanation: string; confidence: number; reconciliation_context?: string | null;
  entity_a: string; entity_canonical_a: string; attribute_a: string;
  value_a: string; unit_a?: string | null; time_scope_a?: string | null;
  qualifiers_a: string[]; quote_a: string; page_a: number; doc_name_a: string; doc_id_a: string;
  entity_b: string; entity_canonical_b: string; attribute_b: string;
  value_b: string; unit_b?: string | null; time_scope_b?: string | null;
  qualifiers_b: string[]; quote_b: string; page_b: number; doc_name_b: string; doc_id_b: string;
}

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  const [activeTab, setActiveTab]   = useState<Tab>("upload");

  // Documents
  const [documents, setDocuments]   = useState<Document[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);

  // Facts
  const [facts, setFacts]           = useState<Fact[]>([]);
  const [factsTotal, setFactsTotal] = useState(0);
  const [factsPage, setFactsPage]   = useState(1);
  const [factsLoading, setFactsLoading] = useState(false);
  const [factsSearch, setFactsSearch]   = useState("");
  const [factsDocFilter, setFactsDocFilter] = useState("");

  // Relationships
  const [relationships, setRelationships] = useState<RelationshipRow[]>([]);
  const [relTotal, setRelTotal]     = useState(0);
  const [relSummary, setRelSummary] = useState({ corroborates: 0, contradicts: 0, reconciled: 0 });
  const [relPage, setRelPage]       = useState(1);
  const [relLoading, setRelLoading] = useState(false);
  const [relFilter, setRelFilter]   = useState("");

  // Four Cases — load ALL relationships (no pagination) for best-example selection
  const [allRelationships, setAllRelationships] = useState<RelationshipRow[]>([]);
  const [casesLoading, setCasesLoading]         = useState(false);

  const PAGE_SIZE = 20;

  const fetchDocuments = useCallback(async () => {
    setDocsLoading(true);
    try {
      const { data } = await api.get("/api/documents");
      setDocuments(data.documents ?? []);
    } catch { /* silently ignore — user sees empty state */ }
    finally { setDocsLoading(false); }
  }, []);

  const fetchFacts = useCallback(async () => {
    setFactsLoading(true);
    try {
      const p = new URLSearchParams({ page: String(factsPage), page_size: String(PAGE_SIZE) });
      if (factsSearch)    p.set("search", factsSearch);
      if (factsDocFilter) p.set("doc_id", factsDocFilter);
      const { data } = await api.get(`/api/facts?${p}`);
      setFacts(data.facts ?? []);
      setFactsTotal(data.total ?? 0);
    } catch { /* silently ignore */ }
    finally { setFactsLoading(false); }
  }, [factsPage, factsSearch, factsDocFilter]);

  const fetchRelationships = useCallback(async () => {
    setRelLoading(true);
    try {
      const p = new URLSearchParams({ page: String(relPage), page_size: String(PAGE_SIZE) });
      if (relFilter) p.set("relation", relFilter);
      const { data } = await api.get(`/api/relationships?${p}`);
      setRelationships(data.relationships ?? []);
      setRelTotal(data.total ?? 0);
      setRelSummary(data.summary ?? { corroborates: 0, contradicts: 0, reconciled: 0 });
    } catch { /* silently ignore */ }
    finally { setRelLoading(false); }
  }, [relPage, relFilter]);

  const fetchAllRelationships = useCallback(async () => {
    setCasesLoading(true);
    try {
      const { data } = await api.get("/api/relationships?page=1&page_size=100");
      setAllRelationships(data.relationships ?? []);
      setRelSummary(data.summary ?? { corroborates: 0, contradicts: 0, reconciled: 0 });
    } catch { /* silently ignore */ }
    finally { setCasesLoading(false); }
  }, []);

  useEffect(() => { if (status === "authenticated") fetchDocuments(); }, [status, fetchDocuments]);

  useEffect(() => {
    if (activeTab === "facts") fetchFacts();
  }, [activeTab, fetchFacts]);

  useEffect(() => {
    if (activeTab === "relationships") fetchRelationships();
  }, [activeTab, fetchRelationships]);

  useEffect(() => {
    if (activeTab === "cases") fetchAllRelationships();
  }, [activeTab, fetchAllRelationships]);

  const handleSearch    = useCallback((q: string) => { setFactsPage(1); setFactsSearch(q); },    []);
  const handleFilterDoc = useCallback((id: string) => { setFactsPage(1); setFactsDocFilter(id); }, []);
  const handleFilterRel = useCallback((r: string)  => { setRelPage(1);   setRelFilter(r); },      []);

  const handleUploadComplete = useCallback(() => {
    fetchDocuments();
    if (activeTab === "facts")         fetchFacts();
    if (activeTab === "relationships") fetchRelationships();
    if (activeTab === "cases")         fetchAllRelationships();
  }, [fetchDocuments, fetchFacts, fetchRelationships, fetchAllRelationships, activeTab]);

  if (status === "loading" || status === "unauthenticated") {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--color-bg)" }}>
        <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "var(--color-primary)" }} />
      </div>
    );
  }

  const completedDocs = documents.filter((d) => d.status === "completed").length;
  const totalFacts    = documents.reduce((s, d) => s + (d.fact_count ?? 0), 0);

  const TABS: { key: Tab; label: string; desc: string }[] = [
    { key: "upload",        label: "📤 Upload",        desc: "Add Documents" },
    { key: "facts",         label: "🔍 Facts",         desc: `${totalFacts} extracted` },
    { key: "relationships", label: "🔗 Relationships",  desc: `${relSummary.corroborates + relSummary.contradicts + relSummary.reconciled} found` },
    { key: "cases",         label: "📋 Four Cases",     desc: "Required demo" },
  ];

  return (
    <div className="min-h-screen" style={{ background: "var(--color-bg)" }}>
      {/* Header */}
      <header className="sticky top-0 z-10 border-b"
        style={{ background: "color-mix(in srgb,var(--color-surface) 90%,transparent)", borderColor: "var(--color-border)", backdropFilter: "blur(12px)" }}>
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
              style={{ background: "var(--color-primary)" }}>F</div>
            <div>
              <h1 className="font-semibold text-sm" style={{ color: "var(--color-fg)" }}>Fact Knowledge Layer</h1>
              <p className="text-[10px]" style={{ color: "var(--color-muted-fg)" }}>Extract · Link · Compare</p>
            </div>
          </div>

          {/* Stats */}
          <div className="hidden md:flex items-center gap-5">
            <Stat label="Docs"          value={completedDocs} />
            <Stat label="Facts"         value={totalFacts} />
            <Stat label="Corroborates"  value={relSummary.corroborates} color="text-green-400" />
            <Stat label="Contradicts"   value={relSummary.contradicts}  color="text-red-400" />
            <Stat label="Reconciled"    value={relSummary.reconciled}   color="text-blue-400" />
          </div>

          {/* User */}
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-medium" style={{ color: "var(--color-fg)" }}>
                {session?.user?.name}
              </p>
              <p className="text-[10px]" style={{ color: "var(--color-muted-fg)" }}>
                {session?.user?.email}
              </p>
            </div>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: "var(--color-primary)", color: "#fff" }}>
              {session?.user?.name?.[0]?.toUpperCase() ?? "U"}
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-muted-fg)",
              }}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl border w-fit"
          style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
          {TABS.map(({ key, label, desc }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className="px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
              style={{
                background: activeTab === key ? "var(--color-primary)" : "transparent",
                color: activeTab === key ? "#fff" : "var(--color-muted-fg)",
              }}>
              {label}
              <span className="ml-1.5 text-[10px] opacity-70">{desc}</span>
            </button>
          ))}
        </div>

        {/* ── Upload ── */}
        {activeTab === "upload" && (
          <div className="space-y-6">
            <div className="card p-6 space-y-4">
              <div>
                <h2 className="font-semibold" style={{ color: "var(--color-fg)" }}>Upload Documents</h2>
                <p className="text-sm mt-0.5" style={{ color: "var(--color-muted-fg)" }}>
                  PDFs are parsed, chunked, and facts extracted via Gemini. Every new document is
                  automatically compared against all your existing documents.
                </p>
              </div>
              <UploadZone onUploadComplete={handleUploadComplete} />
            </div>

            <div className="card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold" style={{ color: "var(--color-fg)" }}>Your Knowledge Base</h2>
                <button onClick={fetchDocuments}
                  className="text-xs flex items-center gap-1 transition-opacity hover:opacity-70"
                  style={{ color: "var(--color-muted-fg)" }}>
                  ↻ Refresh
                </button>
              </div>
              <DocumentList documents={documents} loading={docsLoading} />
            </div>

            {/* Pipeline explainer */}
            <div className="card p-6">
              <h2 className="font-semibold mb-4" style={{ color: "var(--color-fg)" }}>How it works</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { step: "01", icon: "📄", title: "Parse & Chunk", body: "Pages extracted with character offsets. Split into ~1200-char overlapping chunks for provenance." },
                  { step: "02", icon: "🤖", title: "LLM Extraction", body: "Gemini 1.5 Flash extracts atomic facts per chunk. Each fact requires a verbatim source quote." },
                  { step: "03", icon: "🔧", title: "Normalize", body: "Entities canonicalised via bigram similarity. Numbers parsed to comparable form with multipliers." },
                  { step: "04", icon: "⚖️", title: "Compare", body: "New facts matched against YOUR existing facts by entity + attribute. Gemini classifies each pair." },
                ].map((item) => (
                  <div key={item.step} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono" style={{ color: "var(--color-primary)" }}>{item.step}</span>
                      <span className="text-lg">{item.icon}</span>
                    </div>
                    <h3 className="text-sm font-medium" style={{ color: "var(--color-fg)" }}>{item.title}</h3>
                    <p className="text-xs leading-relaxed" style={{ color: "var(--color-muted-fg)" }}>{item.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Facts ── */}
        {activeTab === "facts" && (
          <FactsTable
            facts={facts} total={factsTotal} page={factsPage} pageSize={PAGE_SIZE}
            loading={factsLoading} onPageChange={setFactsPage}
            onSearch={handleSearch} onFilterDoc={handleFilterDoc}
            documents={documents}
          />
        )}

        {/* ── Relationships ── */}
        {activeTab === "relationships" && (
          <RelationshipsView
            relationships={relationships} total={relTotal} summary={relSummary}
            loading={relLoading} page={relPage} pageSize={PAGE_SIZE}
            onPageChange={setRelPage} onFilterRelation={handleFilterRel}
          />
        )}

        {/* ── Four Cases ── */}
        {activeTab === "cases" && (
          <FourCasesPanel relationships={allRelationships} loading={casesLoading} />
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, color = "" }: { label: string; value: number; color?: string }) {
  return (
    <div className="text-center">
      <div className={`font-bold text-sm ${color}`} style={{ color: color ? undefined : "var(--color-fg)" }}>
        {value}
      </div>
      <div className="text-[10px]" style={{ color: "var(--color-muted-fg)" }}>{label}</div>
    </div>
  );
}
