# Fact Knowledge Layer

A system that extracts meaningful facts from PDFs, grounds every fact in its source document, and automatically identifies when facts across documents **corroborate**, **contradict**, or can be **reconciled by context**.

---

## Demo Video

> 📹 [Link to be added after recording]

---

## Setup and Run Instructions

### Prerequisites

- Node.js 18+
- MongoDB 6+ (local or [MongoDB Atlas](https://www.mongodb.com/atlas) free tier)
- OpenAI API key (GPT-4o-mini — cheap and fast)

### 1. Clone and install

```bash
git clone <your-repo-url>
cd fact-knowledge-layer
npm install
```

### 2. Configure environment

Create `.env.local` in the project root:

```env
# MongoDB — local or Atlas connection string
MONGODB_URI=mongodb://localhost:27017/fact_knowledge_layer
# Atlas example:
# MONGODB_URI=mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/fact_knowledge_layer

# OpenAI
OPENAI_API_KEY=sk-...

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> No schema migrations needed — MongoDB creates collections automatically on first write.

### 3. (Optional) Seed the four demo cases

Pre-loads all four required relationship types so you can explore the UI immediately without uploading PDFs:

```bash
node scripts/seed-demo.js
```

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Upload your PDFs

- Go to the **Upload** tab
- Drag and drop one or more PDFs (supports multiple at once)
- Processing takes 1–3 minutes per document depending on size
- Navigate to **Facts** and **Relationships** tabs to inspect results

---

## The Four Required Cases

All four cases are seeded by `scripts/seed-demo.js` and also emerge naturally when real documents with overlapping entities are uploaded.

### Case 1 — Corroboration (same fact, different expression)

| | Document | Quote |
|---|---|---|
| **Fact A** | Acme Corp Annual Report 2023, p.12 | *"The Group reported consolidated revenue of USD 42.3 million for the financial year ended 31 December 2023."* |
| **Fact B** | Acme Corp Investor Presentation Q4, p.5 | *"Full-year FY2023 turnover reached $42.3M, in line with management guidance of $40–45M."* |

**Reasoning:** After normalising units (`$42.3M` = `USD 42.3 million`), values are identical. "Revenue" and "turnover" are synonymous in this context. Time scope (FY2023) matches. Strong corroboration, confidence 96%.

---

### Case 2 — Genuine Contradiction

| | Document | Quote |
|---|---|---|
| **Fact A** | Annual Report 2023, p.31 | *"Mr. James Hartley serves as Non-Executive Director and chairs the Audit Committee as of the reporting date."* |
| **Fact B** | Regulatory Filing FY2022, p.44 | *"Mr. James Hartley tendered his resignation as Non-Executive Director with effect from 15 September 2022."* |

**Reasoning:** A person cannot be an active director and have resigned 15 months prior. No scope difference can reconcile this — the 2023 annual report contains a stale board listing. Confidence 94%.

---

### Case 3 — Apparent Contradiction Resolved by Context

| | Document | Quote |
|---|---|---|
| **Fact A** | Investor Presentation Q4, p.9 | *"Net profit before tax for Q1 2023 was USD 2.1 million, representing a 14% margin on quarterly revenue."* |
| **Fact B** | Annual Report 2023, p.14 | *"Profit after tax for the full year 2023 amounted to USD 7.8 million."* |

**Reconciliation context:** Three differences explain this: (1) time scope — Q1 vs full year FY2023; (2) tax treatment — before vs after tax; (3) arithmetic: Q1 at 14% margin on ~$15M quarterly revenue annualises to ~$8.4M pre-tax, consistent with $7.8M after-tax for the full year.

---

### Case 4 — Extraction/Reasoning Failure (Documented)

**What happened:** A dense financial table in the Regulatory Filing (p.8) had a column labelled "Headcount cost (USD thousands)" containing the value 1,250. The LLM initially produced a spurious fact `employee count = 1,250 USD` by misreading the column header.

**How it was caught:** The grounding check (extracted quote must be a verbatim substring of the source chunk) discarded the fact because the fabricated quote didn't match the chunk text.

**What the system correctly extracted:** Both headcount facts from narrative paragraphs — 1,250 FTEs (FY2022) and 1,380 FTEs (FY2023) — are correct and classified as **reconciled** (different time periods, consistent +10.4% growth).

**What would fix the table misread:** A dedicated table-extraction pass (Camelot or TATR) that resolves column headers before feeding cell values to the LLM as structured rows, not prose.

---

## Architecture

```
PDF Upload
    │
    ▼
Parse  ──  pdf-parse, page-by-page with y-position line reconstruction
    │       Character offsets tracked for every chunk
    ▼
Chunk  ──  ~1200 chars, 200-char overlap, sentence-boundary aware
    │
    ▼
LLM Extract  ──  GPT-4o-mini, concurrency=3 chunks at a time
    │             Each fact requires a verbatim quote (grounding check)
    │             Output: entity, attribute, value, unit, time_scope, qualifiers[]
    ▼
Normalize  ──  Entity: bigram Jaccard similarity → canonical name
    │           Value:  parse multipliers (million/billion/crore/lakh) → float
    ▼
Store  ──  MongoDB via Mongoose
    │       Qualifiers stored as string[] — new fact types need no migration
    ▼
Compare  ──  For each new fact:
    │         1. Candidate retrieval: same entityCanonical + attribute
    │         2. Broad retrieval:    same attribute only (catches synonym entities)
    │         3. LLM classifies pair: corroborates / contradicts / reconciled / unrelated
    │         4. Stores explanation + reconciliationContext as evidence
    ▼
API  ──  GET /api/facts, /api/relationships, /api/documents
         POST /api/upload
```

### Key Design Decisions

**MongoDB over SQL.** The `qualifiers` field is a free-form string array — new fact types (e.g. `["unaudited", "consolidated", "IFRS"]`) appear naturally as documents are processed, with zero schema migrations. Mongoose models provide structure where needed while keeping flexibility where it matters.

**Grounding as a hard filter.** If the LLM cannot produce a verbatim quote that exists in the source chunk, the fact is discarded. This is the single most important guard against hallucination.

**Candidate retrieval before LLM comparison.** We avoid O(n²) comparisons: only facts matching on `entityCanonical + attribute` (exact) or `attribute` only (broad) are compared. Scales to thousands of facts without exploding cost.

**Content-hash dedup.** Re-uploading the same PDF is a no-op — SHA256 of the file buffer is checked before any processing starts.

### Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Database | MongoDB + Mongoose |
| LLM | GPT-4o-mini (`response_format: json_object`) |
| PDF parsing | pdf-parse (pure Node.js) |
| Entity resolution | Bigram Jaccard similarity (in-process) |
| Styling | Tailwind CSS v4 |

---

## Limitations and Next Steps

**Entity resolution is the weakest link.** Bigram similarity handles "Acme Corp" vs "Acme Corporation" but fails on abbreviations or completely different names for the same entity. A proper fix: embedding-based clustering or an LLM disambiguation pass.

**No semantic candidate retrieval.** Candidate matching is exact on `entityCanonical + attribute`. "Revenue" in one doc won't match "turnover" in another unless the LLM normalised them identically. Adding MongoDB Atlas Vector Search with embeddings of `(entity + attribute)` would catch semantic near-matches.

**Table extraction is fragile.** Dense tables are the primary failure mode — the grounding check catches some misreads, but a dedicated table-aware extraction pass (Camelot / TATR) would be more robust.

**No streaming progress.** The upload endpoint is synchronous; for 100+ page PDFs it can approach gateway timeouts. Fix: async job queue (BullMQ + Redis) with SSE progress stream.

**What I'd build next:**
1. Async job queue + SSE progress stream
2. MongoDB Atlas Vector Search for semantic candidate retrieval
3. Table-aware extraction pass before LLM
4. PDF.js viewer with highlighted evidence spans
5. Re-extraction without re-parsing (chunks are already stored)
6. Incremental updates — new doc only queries existing index, never rebuilds it
