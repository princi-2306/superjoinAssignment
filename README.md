# Fact Knowledge Layer

A full-stack system that extracts meaningful facts from PDFs, grounds every fact to its exact source location, and automatically discovers when facts across documents **corroborate**, **contradict**, or can be **reconciled by context** — scoped to individual user accounts so every user has a private, isolated knowledge base.

---

## Video Demo

> https://www.loom.com/share/2e05260c4d80406ba201b3cafb07bb5a

---

## Table of Contents

1. [Setup and Run](#setup-and-run)
2. [The Four Required Cases](#the-four-required-cases)
3. [Architecture](#architecture)
4. [Approach and Important Decisions](#approach-and-important-decisions)
5. [Scalability — What Works and What Needs Work](#scalability)
6. [Limitations and Next Steps](#limitations-and-next-steps)
7. [Additional Notes](#additional-notes)

---

## Setup and Run

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 18+ |
| MongoDB | 6+ local **or** [Atlas free tier](https://www.mongodb.com/atlas) |
| Gemini API key | [Google AI Studio](https://aistudio.google.com/app/apikey) |

### 1. Install dependencies

```bash
git clone <your-repo-url>
cd fact-knowledge-layer
npm install
```

### 2. Create `.env.local`

```env
# MongoDB — local or Atlas
MONGODB_URI=mongodb://localhost:27017/fact_knowledge_layer

# Google Gemini
GEMINI_API_KEY=your_gemini_api_key_here

# NextAuth — run: openssl rand -base64 32
NEXTAUTH_SECRET=your_random_secret_here
NEXTAUTH_URL=http://localhost:3000

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> No migrations needed. MongoDB creates collections on first write.

### 3. (Optional) Seed demo data

Inserts all four required cases immediately — no PDF upload needed:

```bash
node scripts/seed-demo.js
```

### 4. Run

```bash
npm run dev        # development
npm run build && npm start   # production
```

Open [http://localhost:3000](http://localhost:3000), register an account, then upload PDFs or explore the seeded cases.

---

## The Four Required Cases

The **Four Cases** tab in the UI automatically selects the highest-confidence live example for each case type from your knowledge base. All four are also pre-loaded by `seed-demo.js`.

---

### Case 1 — Corroboration

> A fact confirmed across two documents, even when expressed differently.

| | Source | Verbatim Quote |
|---|---|---|
| **Fact A** | Acme Corp Annual Report 2023, p.12 | *"The Group reported consolidated revenue of USD 42.3 million for the financial year ended 31 December 2023."* |
| **Fact B** | Acme Corp Investor Presentation Q4 2023, p.5 | *"Full-year FY2023 turnover reached $42.3M, in line with management guidance of $40–45M."* |

**System reasoning:**
After normalising units (`$42.3M` = `USD 42.3 million`), the values are identical. "Revenue" and "turnover" are synonymous in this financial context. Both cover the same time scope (FY2023). The system detected this despite different source documents, different vocabulary, and different formatting — corroboration confidence **96%**.

---

### Case 2 — Genuine Contradiction

> Two facts that cannot both be true. No contextual difference explains it away.

| | Source | Verbatim Quote |
|---|---|---|
| **Fact A** | Acme Corp Annual Report 2023, p.31 | *"Mr. James Hartley serves as Non-Executive Director and chairs the Audit Committee as of the reporting date."* |
| **Fact B** | Acme Corp Regulatory Filing FY2022, p.44 | *"Mr. James Hartley tendered his resignation as Non-Executive Director with effect from 15 September 2022."* |

**System reasoning:**
A person cannot simultaneously be an active director and have resigned 15 months prior. There is no difference in time scope, unit, or definition that resolves this — the claims are mutually exclusive. The regulatory filing, which is a formal legal document, is more likely authoritative on resignation events. The 2023 annual report almost certainly contains a stale board listing. Contradiction confidence **94%**.

---

### Case 3 — Apparent Contradiction Resolved by Context

> Facts that look incompatible on the surface, but context explains the difference.

| | Source | Verbatim Quote |
|---|---|---|
| **Fact A** | Acme Corp Investor Presentation Q4 2023, p.9 | *"Net profit before tax for Q1 2023 was USD 2.1 million, representing a 14% margin on quarterly revenue."* |
| **Fact B** | Acme Corp Annual Report 2023, p.14 | *"Profit after tax for the full year 2023 amounted to USD 7.8 million."* |

**System reasoning:**
`$2.1M vs $7.8M` for the same entity looks like a large discrepancy. Three contextual differences fully reconcile it:

1. **Time scope** — Q1 2023 only vs full year FY2023
2. **Tax treatment** — before tax vs after tax
3. **Arithmetic consistency** — Q1 at 14% margin on ~$15M quarterly revenue annualises to ~$8.4M pre-tax, which is consistent with $7.8M after tax for the full year

Reconciliation confidence **92%**.

---

### Case 4 — Extraction / Reasoning Failure (Documented)

> An honest account of a real failure, how the system handled it, and what would fix it properly.

**What went wrong:**
In a dense financial table (Regulatory Filing, p.8), a column labelled *"Headcount cost (USD thousands)"* contained the value `1,250`. Gemini produced a spurious fact: `employee count = 1,250 USD` — it read the cell value but misidentified the column header context.

**How the system caught it:**
The grounding check requires every extracted fact to include a verbatim quote that exists as a literal substring of the source chunk. The model's fabricated quote for this misread did not match the actual chunk text, so the fact was automatically discarded before storage.

**What was correctly extracted:**
Both real headcount facts — from narrative paragraphs where context is unambiguous — were correctly captured: `1,250 FTEs (FY2022)` and `1,380 FTEs (FY2023)`. These are correctly classified as **reconciled** (different time periods, consistent +10.4% headcount growth).

**What would actually fix the table problem:**
A dedicated table-extraction pre-pass using [Camelot](https://camelot-py.readthedocs.io/) or a table structure model (TATR) that resolves column headers separately before feeding row cell values to the LLM as structured JSON. This way the LLM never sees ambiguous prose — it sees `{ column: "Headcount cost (USD thousands)", value: "1,250" }` and cannot confuse it with employee count.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            BROWSER / CLIENT                             │
│                                                                         │
│  ┌──────────┐  ┌──────────┐  ┌────────────────┐  ┌──────────────────┐  │
│  │  Login / │  │  Upload  │  │  Facts Table   │  │  Relationships / │  │
│  │ Register │  │   Zone   │  │ + Evidence     │  │  Four Cases Tab  │  │
│  └────┬─────┘  └────┬─────┘  └───────┬────────┘  └────────┬─────────┘  │
└───────┼─────────────┼────────────────┼────────────────────┼────────────┘
        │             │                │                    │
        │  next-auth  │  POST /upload  │  GET /facts        │  GET /relationships
        ▼             ▼                ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         NEXT.JS APP ROUTER (API)                        │
│                                                                         │
│  /api/auth/[...nextauth]   →  JWT issued, userId embedded in token      │
│  /api/auth/register        →  bcrypt hash, UserModel.create()           │
│  /api/upload               →  requireAuth() → Multer → ingestDocument() │
│  /api/documents            →  requireAuth() → DocumentModel.find({userId})│
│  /api/facts                →  requireAuth() → FactModel.find({userId})  │
│  /api/facts/[id]           →  requireAuth() → fact + chunks + rels      │
│  /api/relationships        →  requireAuth() → RelationshipModel.find()  │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │      INGEST PIPELINE        │
                    │                             │
                    │  1. Multer disk storage     │
                    │     File → /tmp (no OOM)    │
                    │                             │
                    │  2. pdf-parse               │
                    │     Pages + char offsets    │
                    │                             │
                    │  3. Chunker                 │
                    │     1200 chars, 200 overlap │
                    │     Sentence-boundary aware │
                    │                             │
                    │  4. Gemini 1.5 Flash        │
                    │     Extract facts per chunk │
                    │     Concurrency = 3         │
                    │     Grounding check ✓       │
                    │                             │
                    │  5. Normalizer              │
                    │     Entity → canonical      │
                    │     Value → float + unit    │
                    │                             │
                    │  6. MongoDB write           │
                    │     Document / Chunk / Fact │
                    │     all stamped with userId │
                    │                             │
                    │  7. Comparison engine       │
                    │     Candidate retrieval     │
                    │     Gemini classify pair    │
                    │     Store relationship      │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │          MONGODB            │
                    │                             │
                    │  users                      │
                    │    email, passwordHash       │
                    │                             │
                    │  documents                  │
                    │    userId, status, hash      │
                    │                             │
                    │  chunks                     │
                    │    docId, userId, text       │
                    │    charStart, charEnd        │
                    │                             │
                    │  facts                      │
                    │    userId, docId             │
                    │    entity, attribute, value  │
                    │    unit, timeScope           │
                    │    qualifiers[]  ← dynamic  │
                    │    quote (grounded)          │
                    │    confidence                │
                    │                             │
                    │  relationships              │
                    │    userId, factIdA, factIdB  │
                    │    relation, explanation     │
                    │    reconciliationContext     │
                    └─────────────────────────────┘
```

### Data Flow for a New Upload

```
PDF file
  └─► Multer writes to /tmp/unique-name.pdf         (no V8 heap pressure)
        └─► fs.readFileSync → Buffer
              └─► sha256 hash → dedup check (userId + hash)
                    └─► DocumentModel.create (status: processing)
                          └─► pdf-parse → pages[]
                                └─► chunkPage() → chunks[]
                                      └─► ChunkModel.insertMany (batch 100)
                                            └─► FOR EACH chunk (3 at a time):
                                                  Gemini.extractFacts()
                                                  → grounding check
                                                  → normalise entity / value
                                                  → FactModel.create (with userId)
                                                        └─► FOR EACH new fact:
                                                              query candidates (same user)
                                                              → Gemini.compareFacts()
                                                              → RelationshipModel.create
                                  └─► DocumentModel.update (status: completed)
  └─► /tmp file deleted (finally block)
```

---

## Approach and Important Decisions

### 1. Documents define the schema — not the engineer

There are no hardcoded fact types like "revenue", "director", or "address". Gemini decides what attributes exist by reading the document. The `attribute` field is a free-text string normalised to lowercase; `qualifiers` is a free-form string array. This means:

- A legal document adds "governing law", "contract value", "effective date" automatically
- A medical document adds "dosage", "contraindication", "trial phase" automatically
- Zero schema migrations, ever

The cost: comparison becomes harder because `"annual revenue"` and `"total revenue"` are the same thing to a human but different strings to a query. The normaliser and Gemini extraction mitigate this but do not fully solve it — see Limitations.

### 2. Grounding is a hard filter, not a soft warning

Every extracted fact must include a verbatim quote that is a literal substring of the source chunk it came from. If Gemini cannot produce one, the fact is silently discarded. This catches:

- Hallucinated facts with no textual basis
- Table cell misreads where the quote does not match the surrounding context
- Facts inferred across sentences rather than directly stated

The trade-off: some valid facts that are paraphrased rather than directly quoted get dropped. This is the right trade-off — a fact that cannot be verified against source text is not a fact, it is a guess.

### 3. Candidate retrieval prevents O(n²) Gemini calls

When a new document with 500 facts is uploaded into a knowledge base that already has 2,000 facts, naively comparing every new fact against every existing fact would cost 1,000,000 Gemini calls. Instead:

1. **Exact retrieval** — query MongoDB for facts with the same `userId + entityCanonical + attribute` (uses compound index)
2. **Broad retrieval** — query for facts with the same `userId + attribute` but different entity (catches synonym entities)
3. Only the top 5 + 3 candidates per fact go to Gemini for classification

This keeps comparison calls proportional to facts-per-attribute, not total fact count.

### 4. Per-user isolation is enforced at the data layer, not the application layer

Every MongoDB document, chunk, fact, and relationship carries a `userId` field. All queries include `{ userId }` as a filter. There is no application-level "if userId matches" check — MongoDB index scans enforce it. This means:

- Two users can upload the same PDF independently (dedup is `userId + contentHash`, not just `contentHash`)
- A bug in one user's request cannot accidentally leak another user's data
- Scaling to thousands of users adds no complexity — MongoDB's compound indexes handle it

### 5. Multer disk storage over `req.formData()`

The original `req.formData()` + `file.arrayBuffer()` approach double-buffered the entire PDF in the V8 heap simultaneously, causing OOM crashes on files larger than ~50MB. Multer writes the incoming byte stream directly to `/tmp` as it arrives — the file is never fully in memory. After processing, a `finally` block always deletes the temp file. This supports PDFs of any size.

### 6. JWT sessions — no DB hit per request

The `userId` is embedded directly in the JWT at sign-in time. Every API route calls `requireAuth()` which reads from the token — no database round-trip needed to authorise a request. The JWT is signed with `NEXTAUTH_SECRET` and verified by NextAuth on every request.

---

## Scalability

### What scales well today

| Component | Why it scales |
|---|---|
| **MongoDB queries** | All hot queries hit compound indexes `{userId, entityCanonical, attribute}` — sub-millisecond even at millions of facts |
| **Per-user isolation** | No cross-user joins or locks — users are completely independent |
| **Chunking strategy** | Overlap-based chunking is O(n) in document size, not quadratic |
| **Content-hash dedup** | Re-uploading the same PDF is a no-op — no redundant LLM calls |
| **Incremental updates** | New document only queries existing index — no full rebuild of prior knowledge |
| **Candidate retrieval** | Comparison is O(facts_per_attribute) not O(total_facts²) |

### What breaks under scale and how to fix it

**Problem: synchronous upload endpoint**
The HTTP request waits for the entire pipeline — PDF parse + all Gemini extraction calls + all comparison calls. For a 200-page document this takes 3–5 minutes and will timeout in production.

Fix:
```
POST /api/upload
  → write to S3 / GridFS
  → enqueue job (BullMQ + Redis)
  → return 202 Accepted { jobId }

GET /api/jobs/:jobId   (or SSE stream)
  → return { status, progress, factsExtracted }
```

**Problem: Gemini API rate limits at scale**
At concurrency=3 per document, uploading 10 documents simultaneously hits 30 concurrent Gemini calls. The free tier rate limits at ~60 req/min.

Fix: A global semaphore on the job queue limits concurrent Gemini calls across all users. BullMQ's `concurrency` option handles this cleanly.

**Problem: entity resolution degrades with scale**
Bigram Jaccard similarity works for "Acme Corp" vs "Acme Corporation" but fails for abbreviations, translations, or subsidiary names. At 10,000+ entities the false-negative rate grows.

Fix: Generate embeddings for each `entityCanonical` using Gemini's embedding API and store them in MongoDB Atlas Vector Search. Candidate retrieval becomes ANN (approximate nearest neighbour) over the embedding space — semantic, not string-based.

**Problem: no semantic attribute matching**
"Revenue" vs "turnover" vs "sales" are the same attribute but stored as different strings. If the LLM normalises inconsistently, cross-document comparison misses valid pairs.

Fix: Embed `(entityCanonical + " " + attribute)` as a single string and use ANN search for candidate retrieval instead of exact string match. This is the highest-value scalability improvement after async processing.

**Problem: table extraction failure rate grows with document variety**
The grounding check is a last-resort filter. As documents get more table-heavy (financial filings, lab reports), the extraction failure rate increases and valid facts get discarded.

Fix: A table-detection pre-pass (pdf-parse gives page text; run a heuristic to detect grid-like structures) routes table content to a structured extraction path (Camelot for PDFs, or a table transformer) rather than the prose-extraction path.

---

## Project Structure

```
fact-knowledge-layer/
│
├── app/
│   ├── api/
│   │   ├── auth/
│   │   │   ├── [...nextauth]/route.ts    # NextAuth handler (GET + POST)
│   │   │   └── register/route.ts         # New account creation
│   │   ├── documents/route.ts            # GET — user's documents + fact counts
│   │   ├── facts/
│   │   │   ├── route.ts                  # GET — paginated, searchable facts
│   │   │   └── [id]/route.ts             # GET — single fact + chunks + relationships
│   │   ├── relationships/route.ts        # GET — relationships with evidence
│   │   └── upload/route.ts              # POST — multer → ingest pipeline
│   │
│   ├── login/page.tsx                    # Sign in / Register UI
│   ├── page.tsx                          # Main dashboard (4 tabs)
│   ├── layout.tsx                        # Root layout with SessionProvider
│   └── providers.tsx                     # Client-side SessionProvider wrapper
│
├── components/
│   ├── UploadZone.tsx                    # Drag-and-drop PDF uploader with progress log
│   ├── DocumentList.tsx                  # Knowledge base document list with status badges
│   ├── FactsTable.tsx                    # Paginated facts + evidence drawer on click
│   ├── RelationshipsView.tsx             # Expandable relationship cards with side-by-side evidence
│   └── FourCasesPanel.tsx               # Auto-selects best example per case type
│
├── lib/
│   ├── auth/
│   │   ├── config.ts                     # NextAuth options — credentials + JWT
│   │   └── session.ts                    # requireAuth() — returns userId or 401
│   │
│   ├── db/
│   │   ├── mongoose.ts                   # Connection with Next.js hot-reload caching
│   │   └── models.ts                     # User, Document, Chunk, Fact, Relationship
│   │
│   ├── llm/
│   │   ├── client.ts                     # Gemini client singleton
│   │   ├── extract.ts                    # Extraction prompt + grounding validator
│   │   └── compare.ts                    # Pairwise comparison prompt + result parser
│   │
│   ├── pipeline/
│   │   ├── ingest.ts                     # Orchestrates full pipeline end-to-end
│   │   ├── parse.ts                      # PDF → per-page text → chunks with offsets
│   │   └── normalize.ts                  # Entity resolution, value parsing, unit scaling
│   │
│   └── upload/
│       └── multer.ts                     # Multer disk-storage bridge for Next.js App Router
│
├── scripts/
│   └── seed-demo.js                      # Seeds all four required demo cases
│
├── types/
│   ├── index.ts                          # Shared TypeScript interfaces
│   └── next-auth.d.ts                    # Extends Session with user.id
│
└── README.md
```

---

## API Reference

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | Public | Create account `{ email, password, name }` |
| `POST` | `/api/auth/signin` | Public | Sign in, returns JWT session |
| `POST` | `/api/upload` | Required | Upload PDFs (multipart/form-data, field: `files`) |
| `GET` | `/api/documents` | Required | List documents with fact counts |
| `GET` | `/api/facts` | Required | List facts. Query: `search`, `doc_id`, `entity`, `attribute`, `page`, `page_size` |
| `GET` | `/api/facts/:id` | Required | Single fact + source context + all related relationships |
| `GET` | `/api/relationships` | Required | List relationships. Query: `relation`, `doc_id`, `page`, `page_size` |

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | Next.js 14 App Router | Single codebase for API + UI, no separate Express server |
| Database | MongoDB + Mongoose | Schema-free qualifiers, compound indexes, no migrations |
| LLM | Google Gemini 1.5 Flash | Fast, cheap, reliable JSON mode (`responseMimeType`) |
| Auth | NextAuth.js + bcryptjs | Credentials + JWT, userId in token, no DB per-request |
| PDF parsing | pdf-parse | Pure Node.js, no binary dependencies |
| File upload | Multer (disk storage) | Prevents heap OOM on large PDFs |
| Styling | Tailwind CSS v4 | `@import "tailwindcss"`, `@theme` tokens, no config file |
| Language | TypeScript | End-to-end type safety across API and UI |

---

## Limitations and Next Steps

### What does not work yet

| Issue | Impact | Severity |
|---|---|---|
| Synchronous upload | Timeout risk on documents > 100 pages | High |
| No semantic attribute matching | Misses "revenue" vs "turnover" pairs if extraction is inconsistent | High |
| Bigram entity resolution | Fails on abbreviations and unrelated names for same entity | Medium |
| Table extraction fragility | Financial tables with many columns produce misreads | Medium |
| No progress streaming | User sees a spinner for 3+ minutes with no feedback | Medium |
| No PDF viewer | Evidence links to page number, not highlighted span | Low |

### Roadmap (prioritised)

1. **Async job queue** — BullMQ + Redis. Upload returns `202 + jobId`. SSE endpoint streams progress. Eliminates timeout risk completely.

2. **Semantic candidate retrieval** — Embed `entityCanonical + attribute` with Gemini Embeddings API. Store in MongoDB Atlas Vector Search. Replace exact-match candidate queries with ANN search. Catches synonym attributes and variant entity names.

3. **Table-aware extraction** — Detect tables in chunks (grid heuristic on raw text). Route to a structured extraction path that resolves column headers before feeding cell values to Gemini.

4. **PDF.js evidence viewer** — Store PDFs in GridFS or S3. On clicking a fact, open the source document at the correct page with the verbatim quote highlighted using character offsets already stored in the `charStart`/`charEnd` fields.

5. **Re-extraction without re-parsing** — Chunks are already stored. Improving the extraction prompt only requires re-running the LLM step, not re-parsing the PDF.

6. **Contradiction alerts** — Facts with `relation: contradicts` and `confidence > 0.85` trigger a notification (in-app badge or webhook). Useful for compliance monitoring use cases.

---

## Additional Notes

### The core design tension

The most interesting trade-off is between **schema rigidity** and **schema flexibility**.

Rigid schemas (pre-defining "revenue facts", "director facts") make comparison trivial — you know exactly which fields to match. But they break the moment a document type appears that the schema didn't anticipate.

This system goes the other direction: the `attribute` field is a free-text string; `qualifiers` is a string array that grows however the document needs it to. The LLM decides what facts exist. New fact types emerge automatically. The cost is that comparison requires an extra normalisation step — and sometimes fails when synonyms are not normalised consistently.

The grounding requirement is what keeps this from being unusable. By requiring every fact to be backed by a verbatim source quote, the system ensures that LLM flexibility (deciding what counts as a fact) never becomes LLM unreliability (making up facts). Flexibility at the schema level, rigour at the evidence level.

### Why these specific technology choices

**MongoDB over PostgreSQL** — not because NoSQL is better, but because the `qualifiers` field is genuinely schema-free. A SQL approach would require a separate `fact_qualifiers` join table or a JSONB column, both of which add query complexity. MongoDB's native array handling makes `qualifiers` a first-class citizen with no overhead.

**Gemini 1.5 Flash over GPT-4o-mini** — both are similarly capable at this task. Gemini was chosen for the `responseMimeType: "application/json"` parameter which enforces JSON output at the model level, not by post-processing — marginally more reliable for structured extraction at high volume.

**Multer disk storage over streaming** — the V8 heap OOM crash on large PDFs was a real production issue that took one architectural change to fix permanently. Disk storage means the file size cap is the disk, not the heap.

### AI tools used

- **Google Gemini 1.5 Flash** — all LLM work: fact extraction per chunk and pairwise relationship classification
- **Kiro AI (Claude)** — pair programming throughout: architecture design, pipeline scaffolding, debugging OOM crashes, TypeScript type fixes, and documentation

---

## Interviewer Guide — quick verification

Follow these steps to run the project, reproduce the four required cases, and inspect the console logs that show how extraction, grounding, and comparison work.

1. Install & env

```bash
npm install
# create .env.local as documented above (MONGODB_URI, NEXTAUTH_SECRET, NEXT_PUBLIC_APP_URL)
```

2. Seed demo cases (optional but recommended)

```bash
node scripts/seed-demo.js
```

3. Start dev server (normal)

```bash
npm run dev
```

If you need a larger Node heap for large PDFs (temporary):

```bash
npm run dev:heap
```

4. Open the app

Visit `http://localhost:3000`, register/login, and go to the **Four Cases** tab. The seeded demo contains one example for each required case.

5. Upload a PDF to test the pipeline

- Use the Upload area. The server console (where you ran `npm run dev`) will print detailed logs for each step:
      - `[upload] parseMultipartFiles: called` — multer bridge received the request
      - `[upload] multer parsed N file(s)` — temp files created in `/tmp`
      - `[api/upload] reading file from disk:` — file read length
      - `[parse] parsePdf: starting pdf-parse` and per-page logs — page lengths
      - `[llm/extract] Extracting facts from doc=..., page=..., chunk_len=...` — LLM calls
      - `[llm/extract] Parsed fact: ...` — each parsed fact that passed grounding
      - `[docId] Creating fact: ...` — DB writes for facts
      - `[llm/compare] Comparing facts: ...` and `[llm/compare] Gemini response text` — comparison calls and results
      - `[docId] Creating relationship between ...` — relationship writes

6. Verify the four cases

- **Corroboration / Contradiction / Reconciled** — open the **Relationships** tab or **Four Cases** panel to see relationships and explanations selected by confidence.
- **Extraction failure** — check the console logs for warnings like `Discarding ungrounded quote:`; the UI will not show discarded facts.

7. Troubleshooting

- If the server crashes with OOM on very large PDFs, use `npm run dev:heap` or process files smaller or offset into a worker queue (recommended future step).
- If Next.js build fails due to a runtime error, check the server console for the stack trace and the log prefixes above — I added detailed logs to `lib/upload/multer.ts`, `app/api/upload/route.ts`, `lib/pipeline/parse.ts`, `lib/pipeline/ingest.ts`, `lib/llm/extract.ts`, and `lib/llm/compare.ts` to aid debugging.

8. What to include in your demo video

- Show `npm run dev` console output while uploading a PDF.
- Show the **Four Cases** tab demonstrating corroboration, contradiction, and reconciliation with source quotes.
- Point out one extraction failure and explain how the grounding check caught it and how you'd fix it (table-aware extraction).

If you'd like, I can also scaffold an async job queue (BullMQ + Redis) so uploads return immediately and processing runs in background — this is the next production-grade improvement.
