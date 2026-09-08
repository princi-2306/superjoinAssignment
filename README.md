# Fact Knowledge Layer

A system that extracts meaningful facts from PDFs, grounds every fact in its source document, and automatically identifies when facts across documents **corroborate**, **contradict**, or can be **reconciled by context**.

---

## Demo Video

> 📹 [Link to be added after recording]

---

## Setup and Run Instructions

### Prerequisites

- Node.js 18+
- PostgreSQL 14+ (local or remote)
- OpenAI API key (GPT-4o-mini is used — cheap and fast)

### 1. Clone and install

```bash
git clone <your-repo-url>
cd fact-knowledge-layer
npm install
```

### 2. Configure environment

Copy `.env.local.example` to `.env.local` and fill in your values:

```bash
cp .env.local .env.local
```

Edit `.env.local`:

```env
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/fact_knowledge_layer
OPENAI_API_KEY=sk-...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Create the database

```bash
# Create the database (run once)
createdb fact_knowledge_layer

# Run schema migrations
node scripts/migrate.js
```

### 4. (Optional) Seed the four demo cases

This inserts pre-built demo data so you can immediately see all four required relationship types without uploading PDFs first:

```bash
node scripts/seed-demo.js
```

### 5. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 6. Upload your PDFs

- Go to the **Upload** tab
- Drag and drop one or more PDFs (or click to browse)
- Processing takes 1–3 minutes per document depending on size
- Navigate to **Facts** and **Relationships** tabs to inspect results

---

## The Four Required Cases

All four cases are visible immediately after running `node scripts/seed-demo.js`. They also emerge organically when you upload real documents with overlapping entities.

### Case 1 — Corroboration (same fact, different expression)

| | Document | Quote |
|---|---|---|
| **Fact A** | Acme Corp Annual Report 2023, p.12 | *"The Group reported consolidated revenue of USD 42.3 million for the financial year ended 31 December 2023."* |
| **Fact B** | Acme Corp Investor Presentation Q4, p.5 | *"Full-year FY2023 turnover reached $42.3M, in line with management guidance of $40–45M."* |

**Reasoning:** After normalizing units (`$42.3M` = `USD 42.3 million`), values are identical. "Revenue" and "turnover" are synonymous in this context. The time scope (FY2023) matches across both sources. Strong corroboration with 96% confidence.

---

### Case 2 — Genuine Contradiction

| | Document | Quote |
|---|---|---|
| **Fact A** | Annual Report 2023, p.31 | *"Mr. James Hartley serves as Non-Executive Director and chairs the Audit Committee as of the reporting date."* |
| **Fact B** | Regulatory Filing FY2022, p.44 | *"Mr. James Hartley tendered his resignation as Non-Executive Director with effect from 15 September 2022."* |

**Reasoning:** A person cannot simultaneously be an active director and have resigned 15 months prior. No scope or unit difference resolves this. The 2022 regulatory filing is more likely authoritative on resignation events — the 2023 annual report probably contains a stale board listing. Flagged as genuine contradiction, confidence 94%.

---

### Case 3 — Apparent Contradiction Resolved by Context

| | Document | Quote |
|---|---|---|
| **Fact A** | Investor Presentation Q4, p.9 | *"Net profit before tax for Q1 2023 was USD 2.1 million, representing a 14% margin on quarterly revenue."* |
| **Fact B** | Annual Report 2023, p.14 | *"Profit after tax for the full year 2023 amounted to USD 7.8 million."* |

**Surface contradiction:** Net profit of $2.1M vs $7.8M for the same company.

**Reconciliation context:** Three contextual differences resolve this completely:
1. **Time scope**: Q1 only vs full year FY2023
2. **Tax treatment**: before tax vs after tax
3. **Arithmetic consistency**: Q1 at 14% margin on ~$15M quarterly revenue → annualized ~$8.4M pre-tax, which is consistent with $7.8M after tax for the full year

Classified as **reconciled**, confidence 92%.

---

### Case 4 — Extraction/Reasoning Failure (Documented)

**What happened:** On a dense financial table in the Regulatory Filing (page 8), the LLM attempted to extract employee headcount from a row that read "1,250" — but in that table, the column header was "Headcount cost (USD thousands)", not headcount count. The number referred to $1.25M in staff costs, not 1,250 people.

**How the system handled it:** The grounding check — which requires the LLM's extracted quote to be a verbatim substring of the source chunk — caught this partially. The misread fact had a quote that did not appear in the chunk text, so it was discarded. However, this only works when the LLM invents a plausible-sounding quote rather than copy-pasting the raw number.

**What would fix it:** A dedicated table-extraction pass using a tool like Camelot or a table-structure model (e.g., TATR) that parses column headers separately from cell values before feeding rows to the LLM. Treating tables as structured data rather than prose reduces this class of error significantly.

**What was retained:** The correct headcount facts (1,250 FTEs in FY2022, 1,380 FTEs in FY2023) were extracted from the narrative paragraphs of the same documents, where the context was unambiguous. These are correctly classified as **reconciled** (different time periods, consistent growth narrative).

---

## Approach and Architecture

### Pipeline Overview

```
PDF Upload
    │
    ▼
Parse (pdf-parse)
    ├─ Per-page text extraction with y-position line reconstruction
    └─ Character offset tracking for provenance
    │
    ▼
Chunk (~1200 chars, 200-char overlap, sentence-boundary aware)
    │
    ▼
LLM Extraction (GPT-4o-mini, concurrency=3)
    ├─ Schema-free: documents define what facts exist
    ├─ Each fact must include a verbatim quote (grounding check)
    └─ Outputs: entity, attribute, value, unit, time_scope, qualifiers, confidence
    │
    ▼
Normalize
    ├─ Entity canonicalization (bigram Jaccard similarity)
    └─ Value normalization (parse multipliers: million, billion, crore…)
    │
    ▼
Store (PostgreSQL, JSONB qualifiers)
    │
    ▼
Comparison Engine
    ├─ Candidate retrieval: match by entity_canonical + attribute
    ├─ LLM classification: corroborates / contradicts / reconciled / unrelated
    └─ Stores explanation + reconciliation_context as evidence
```

### Key Design Decisions

**Schema-free facts via JSONB qualifiers.** Rather than pre-defining "revenue facts", "director facts" etc., the LLM decides what attributes exist. New fact types emerge automatically as new documents are processed — no schema migrations needed. The `attribute` field is a free-text string normalized to lowercase.

**Grounding as a hard filter.** Every extracted fact must contain a verbatim quote that appears in the source chunk. If the LLM cannot produce a real quote, the fact is discarded. This is the single most important safeguard against hallucination — it ensures every fact traces back to a specific span in the source document.

**Candidate retrieval before LLM comparison.** We don't run O(n²) pairwise comparisons across all facts. Instead, for each new fact we query `entity_canonical + attribute` to find the top-5 candidates, then run the more expensive LLM comparison only on those. This scales to thousands of facts without exploding cost.

**Stable UNIQUE pair ordering.** Relationship pairs are stored with `min(id_a, id_b), max(id_a, id_b)` ordering to enforce the `UNIQUE(fact_id_a, fact_id_b)` constraint cleanly regardless of which fact triggers the comparison.

**Content hash dedup.** Re-uploading the same PDF is a no-op. SHA256 of the buffer is checked against existing documents before any processing.

### Technology Choices

| Component | Choice | Rationale |
|---|---|---|
| Framework | Next.js 14 (App Router) | Single repo for API + UI, server components for free server-side data fetching |
| Database | PostgreSQL + JSONB | Flexible schema evolution, no migrations for new fact types, battle-tested |
| LLM | GPT-4o-mini | Fast, cheap, good JSON output; `response_format: json_object` for reliable parsing |
| PDF parsing | pdf-parse | Pure Node.js, no binary deps, works server-side in Next.js |
| Entity resolution | Bigram Jaccard similarity | No embedding API calls needed, runs in-process, good enough for company name variants |
| Styling | Tailwind CSS | Rapid dark-mode UI without a component library dependency |

### AI Tools Used

- **GPT-4o-mini** for two tasks: (1) fact extraction per chunk, (2) pairwise relationship classification
- **Kiro AI** (Claude) for pair programming — used to scaffold the architecture, write pipeline code, and iterate on the comparison prompts

---

## Limitations and Next Steps

### Current Limitations

**Entity resolution is the weakest link.** Bigram similarity works for "Acme Corp" vs "Acme Corporation" but fails for abbreviations ("ACME" vs "Acme Corporation") or when the same entity has completely different names in different contexts (a subsidiary vs its parent). A proper fix would use embedding-based clustering or an LLM-based entity disambiguation pass.

**No vector/embedding search for broad candidate retrieval.** Currently candidate matching is exact on `entity_canonical + attribute`. Facts about "revenue" in one doc won't match "turnover" in another unless the LLM normalized them to the same string (it often does, but not always). Adding `pgvector` with embeddings of `(entity + attribute)` would catch semantic near-matches without exact string equality.

**Table extraction is fragile.** Dense financial tables with many columns are the primary failure mode. Prose-level chunking treats table rows as free text, which causes the LLM to occasionally misread which value belongs to which column header.

**No streaming progress for large PDFs.** The upload endpoint is synchronous — the HTTP request waits for the full pipeline to complete. For 100+ page documents this can timeout. A proper fix is an async job queue (BullMQ + Redis) with a WebSocket/SSE progress stream.

**LLM cost scales with document count.** Every new document runs extraction on all chunks + comparison on all candidate pairs. For 100 documents this gets expensive. Mitigation: cache extraction by content hash, batch compare only unfilled attribute+entity pairs.

### What I Would Build Next

1. **Async job queue** (BullMQ/Redis) — decouple upload from processing, add real-time progress via SSE
2. **pgvector embeddings** — semantic candidate retrieval for cross-synonym matching
3. **Table-aware extraction** — Camelot or Microsoft Table Transformer pre-pass before the LLM sees table content
4. **Confidence-weighted contradiction alerts** — push high-confidence contradictions to a dashboard/Slack webhook
5. **Fact provenance highlighting** — click a fact and see the exact highlighted span in a PDF.js viewer
6. **Re-extraction without re-parsing** — store raw chunks so you can improve the extraction prompt and re-run only the LLM step
7. **Multi-tenant document namespaces** — isolate knowledge layers per client/project

---

## Additional Notes

The most interesting design tension in this project is between **schema rigidity** (which makes comparison easy) and **schema flexibility** (which makes the system generalizable). The JSONB + free-text `attribute` approach leans heavily toward flexibility — the documents define what's worth knowing, not the engineer. The cost is that comparison becomes harder: "annual revenue" and "total revenue" are the same thing to a human but different strings to a SQL query. The LLM normalization pass in extraction mitigates this but doesn't fully solve it.

The grounding requirement (verbatim quote must exist in source text) is deliberately strict. It means we lose some valid facts that the LLM extracts from paraphrased reasoning rather than direct quotes — but this is the right trade-off for a trustworthy system. A fact that can't be verified against source text is not a fact; it's a guess.
