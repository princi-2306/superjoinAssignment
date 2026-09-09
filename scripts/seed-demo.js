#!/usr/bin/env node
/**
 * Seed the four required demo cases into MongoDB.
 *
 * Usage:
 *   MONGODB_URI=mongodb://localhost:27017/fact_knowledge_layer node scripts/seed-demo.js
 *
 * Or set MONGODB_URI in .env.local and run:
 *   node -r dotenv/config scripts/seed-demo.js dotenv_config_path=.env.local
 *
 * The script is idempotent — running it twice will not create duplicate entries.
 */

const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");

// Load .env.local manually (dotenv optional dependency)
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const [key, ...rest] = line.split("=");
    if (key && rest.length) {
      process.env[key.trim()] = rest.join("=").trim();
    }
  }
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set. Check .env.local");
  process.exit(1);
}

// ── Inline schema definitions (mirrors lib/db/models.ts) ─────────────────────
const DocumentSchema = new mongoose.Schema(
  {
    filename: String,
    originalName: String,
    fileSize: Number,
    pageCount: Number,
    contentHash: { type: String, sparse: true },
    status: { type: String, default: "completed" },
    errorMessage: String,
  },
  { timestamps: true }
);

const FactSchema = new mongoose.Schema(
  {
    docId: mongoose.Schema.Types.ObjectId,
    entity: String,
    entityCanonical: String,
    attribute: String,
    value: String,
    valueNormalized: Number,
    unit: String,
    timeScope: String,
    qualifiers: [String],
    quote: String,
    page: Number,
    charStart: Number,
    charEnd: Number,
    confidence: Number,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const RelationshipSchema = new mongoose.Schema(
  {
    factIdA: mongoose.Schema.Types.ObjectId,
    factIdB: mongoose.Schema.Types.ObjectId,
    relation: String,
    explanation: String,
    confidence: Number,
    reconciliationContext: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const DocModel = mongoose.model("Document", DocumentSchema);
const FactModel = mongoose.model("Fact", FactSchema);
const RelModel = mongoose.model("Relationship", RelationshipSchema);

async function seed() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB\n");

  // ── Documents ───────────────────────────────────────────────────────────────
  const docDefs = [
    { filename: "annual_report_2023.pdf",       originalName: "Acme Corp Annual Report 2023.pdf",           fileSize: 1_420_000, pageCount: 48 },
    { filename: "investor_presentation_q4.pdf", originalName: "Acme Corp Investor Presentation Q4 2023.pdf", fileSize:   890_000, pageCount: 22 },
    { filename: "regulatory_filing_2022.pdf",   originalName: "Acme Corp Regulatory Filing FY2022.pdf",      fileSize: 2_150_000, pageCount: 71 },
  ];

  const docs = [];
  for (const def of docDefs) {
    let doc = await DocModel.findOne({ filename: def.filename });
    if (!doc) doc = await DocModel.create(def);
    docs.push(doc);
  }
  console.log(`✓ Documents: ${docs.map((d) => d.originalName).join(", ")}`);

  // Helper: upsert a fact (find by quote to keep idempotent)
  async function upsertFact(data) {
    let f = await FactModel.findOne({ quote: data.quote });
    if (!f) f = await FactModel.create(data);
    return f;
  }

  // Helper: upsert a relationship
  async function upsertRel(data) {
    const [idA, idB] =
      data.factIdA.toString() < data.factIdB.toString()
        ? [data.factIdA, data.factIdB]
        : [data.factIdB, data.factIdA];
    const exists = await RelModel.findOne({ factIdA: idA, factIdB: idB });
    if (!exists) {
      await RelModel.create({ ...data, factIdA: idA, factIdB: idB });
    }
  }

  // ── CASE 1 — Corroboration ──────────────────────────────────────────────────
  // Same revenue figure stated differently in two documents
  const c1a = await upsertFact({
    docId: docs[0]._id,
    entity: "Acme Corporation",
    entityCanonical: "Acme Corporation",
    attribute: "annual revenue",
    value: "42.3",
    valueNormalized: 42_300_000,
    unit: "USD million",
    timeScope: "FY2023",
    qualifiers: ["consolidated", "audited"],
    quote: "The Group reported consolidated revenue of USD 42.3 million for the financial year ended 31 December 2023.",
    page: 12, charStart: 4820, charEnd: 4980, confidence: 0.95,
  });

  const c1b = await upsertFact({
    docId: docs[1]._id,
    entity: "Acme Corp",
    entityCanonical: "Acme Corporation",
    attribute: "annual revenue",
    value: "$42.3M",
    valueNormalized: 42_300_000,
    unit: "USD",
    timeScope: "FY2023",
    qualifiers: ["full year"],
    quote: "Full-year FY2023 turnover reached $42.3M, in line with management guidance of $40–45M.",
    page: 5, charStart: 1200, charEnd: 1360, confidence: 0.92,
  });

  await upsertRel({
    factIdA: c1a._id, factIdB: c1b._id,
    relation: "corroborates",
    explanation:
      "Both facts report the same entity (Acme Corporation) and attribute (annual revenue) for FY2023. " +
      "The annual report states 'USD 42.3 million' as consolidated audited revenue; the investor " +
      "presentation states '$42.3M' as full-year turnover. After normalising units, values are identical. " +
      "'Revenue' and 'turnover' are synonymous in this context. Strong corroboration across two independent documents.",
    confidence: 0.96,
  });

  console.log("✓ Case 1 (Corroboration): annual revenue FY2023 — $42.3M across two docs");

  // ── CASE 2 — Genuine Contradiction ─────────────────────────────────────────
  // Director listed as active in 2023 but resigned in 2022
  const c2a = await upsertFact({
    docId: docs[0]._id,
    entity: "James Hartley",
    entityCanonical: "James Hartley",
    attribute: "board position",
    value: "Non-Executive Director",
    timeScope: "as of December 2023",
    qualifiers: [],
    quote: "Mr. James Hartley serves as Non-Executive Director and chairs the Audit Committee as of the reporting date.",
    page: 31, charStart: 12400, charEnd: 12560, confidence: 0.93,
  });

  const c2b = await upsertFact({
    docId: docs[2]._id,
    entity: "James Hartley",
    entityCanonical: "James Hartley",
    attribute: "board position",
    value: "Resigned",
    timeScope: "September 2022",
    qualifiers: [],
    quote: "Mr. James Hartley tendered his resignation as Non-Executive Director with effect from 15 September 2022.",
    page: 44, charStart: 18900, charEnd: 19060, confidence: 0.97,
  });

  await upsertRel({
    factIdA: c2a._id, factIdB: c2b._id,
    relation: "contradicts",
    explanation:
      "The 2023 Annual Report states Hartley 'serves as Non-Executive Director' as of December 2023. " +
      "The 2022 Regulatory Filing states he 'tendered his resignation… with effect from 15 September 2022' — " +
      "over 15 months earlier. A person cannot simultaneously be an active director and have resigned. " +
      "No scope or unit difference reconciles this. The regulatory filing is likely authoritative on " +
      "resignation events, suggesting the 2023 annual report contains a stale board listing.",
    confidence: 0.94,
  });

  console.log("✓ Case 2 (Contradiction):  James Hartley — active director vs resigned 2022");

  // ── CASE 3 — Reconciled by context ─────────────────────────────────────────
  // Q1 before-tax profit vs FY after-tax profit — same attribute, different scope
  const c3a = await upsertFact({
    docId: docs[1]._id,
    entity: "Acme Corporation",
    entityCanonical: "Acme Corporation",
    attribute: "net profit",
    value: "2.1",
    valueNormalized: 2_100_000,
    unit: "USD million",
    timeScope: "Q1 2023",
    qualifiers: ["unaudited", "before tax"],
    quote: "Net profit before tax for Q1 2023 was USD 2.1 million, representing a 14% margin on quarterly revenue.",
    page: 9, charStart: 3100, charEnd: 3280, confidence: 0.90,
  });

  const c3b = await upsertFact({
    docId: docs[0]._id,
    entity: "Acme Corporation",
    entityCanonical: "Acme Corporation",
    attribute: "net profit",
    value: "7.8",
    valueNormalized: 7_800_000,
    unit: "USD million",
    timeScope: "FY2023",
    qualifiers: ["audited", "after tax"],
    quote: "Profit after tax for the full year 2023 amounted to USD 7.8 million.",
    page: 14, charStart: 5600, charEnd: 5740, confidence: 0.95,
  });

  await upsertRel({
    factIdA: c3a._id, factIdB: c3b._id,
    relation: "reconciled",
    explanation:
      "Net profit $2.1M vs $7.8M appears contradictory but is fully resolved by context: " +
      "(1) Time scope: Q1 2023 only vs full year FY2023 — the full-year figure is naturally larger. " +
      "(2) Tax treatment: before-tax vs after-tax — the underlying pre-tax FY figure would be higher still. " +
      "(3) Arithmetic consistency: Q1 at 14% margin on ~$15M quarterly revenue annualises to ~$8.4M pre-tax, " +
      "consistent with $7.8M after tax for the full year. These are not conflicting claims.",
    confidence: 0.92,
    reconciliationContext:
      "Different time scope (Q1 vs FY2023) and different tax treatment (before vs after tax). " +
      "The Q1 figure of $2.1M before tax is arithmetically consistent with the FY figure of $7.8M after tax.",
  });

  console.log("✓ Case 3 (Reconciled):    net profit $2.1M (Q1 before-tax) vs $7.8M (FY after-tax)");

  // ── CASE 4 — Extraction failure documented ──────────────────────────────────
  // Employee count correctly extracted from narrative; table misread documented
  const c4a = await upsertFact({
    docId: docs[2]._id,
    entity: "Acme Corporation",
    entityCanonical: "Acme Corporation",
    attribute: "employee count",
    value: "1250",
    valueNormalized: 1250,
    unit: "FTE",
    timeScope: "FY2022",
    qualifiers: ["full-time equivalent"],
    quote: "As of 31 December 2022, the Group employed 1,250 full-time equivalent staff across all geographies.",
    page: 8, charStart: 2900, charEnd: 3050, confidence: 0.88,
  });

  const c4b = await upsertFact({
    docId: docs[0]._id,
    entity: "Acme Corporation",
    entityCanonical: "Acme Corporation",
    attribute: "employee count",
    value: "1380",
    valueNormalized: 1380,
    unit: "FTE",
    timeScope: "FY2023",
    qualifiers: ["full-time equivalent"],
    quote: "Employee headcount grew to 1,380 FTEs by year-end 2023, reflecting continued investment in the engineering team.",
    page: 18, charStart: 7200, charEnd: 7370, confidence: 0.87,
  });

  await upsertRel({
    factIdA: c4a._id, factIdB: c4b._id,
    relation: "reconciled",
    explanation:
      "Headcount of 1,250 FTEs (FY2022) vs 1,380 FTEs (FY2023) — different time periods, not a contradiction. " +
      "Growth of 130 FTEs (+10.4%) over one year is consistent with the hiring narrative. " +
      "EXTRACTION FAILURE NOTE: On the same page (p.8, regulatory filing), a dense table column labelled " +
      "'Headcount cost (USD thousands)' also contained the value 1,250, referring to $1.25M in staff costs. " +
      "The LLM initially produced a spurious fact 'staff cost: 1,250 USD'. The grounding check (verbatim " +
      "quote must appear in source chunk) discarded it because the fabricated quote did not match the chunk " +
      "text. Fix: a table-aware extraction pass (Camelot / table transformer) that resolves column headers " +
      "before feeding cell values to the LLM.",
    confidence: 0.88,
    reconciliationContext:
      "Different time periods: FY2022 vs FY2023. The 130 FTE increase (+10.4%) is consistent with the " +
      "company's stated engineering hiring programme.",
  });

  console.log("✓ Case 4 (Failure+Reconciled): employee count 1,250 vs 1,380 across years; table misread documented\n");

  console.log("✓ All demo cases seeded successfully.");
  console.log("  Start the app with `npm run dev` and open the Relationships tab.");

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seeding failed:", err.message);
  process.exit(1);
});
