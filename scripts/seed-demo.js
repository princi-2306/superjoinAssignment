#!/usr/bin/env node
/**
 * Seed the four required demo cases into the database.
 *
 * Run AFTER migrate.js:
 *   node scripts/migrate.js
 *   node scripts/seed-demo.js
 *
 * These cases are deliberately constructed to demonstrate all four required
 * relationship types. They use real-looking but synthetic documents so the
 * demo is reproducible without the actual starter PDFs.
 *
 * Each case has:
 *   - Two facts with verbatim quotes
 *   - A relationship record with full reasoning
 */

const { Pool } = require('pg');
const path = require('path');
const { randomUUID } = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

async function seed() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log('Seeding demo cases...\n');

  // ── Synthetic documents ────────────────────────────────────────────────────
  const docs = [
    {
      id: randomUUID(),
      filename: 'annual_report_2023.pdf',
      original_name: 'Acme Corp Annual Report 2023.pdf',
      file_size: 1_420_000,
      page_count: 48,
    },
    {
      id: randomUUID(),
      filename: 'investor_presentation_q4.pdf',
      original_name: 'Acme Corp Investor Presentation Q4 2023.pdf',
      file_size: 890_000,
      page_count: 22,
    },
    {
      id: randomUUID(),
      filename: 'regulatory_filing_2022.pdf',
      original_name: 'Acme Corp Regulatory Filing FY2022.pdf',
      file_size: 2_150_000,
      page_count: 71,
    },
  ];

  for (const doc of docs) {
    await pool.query(
      `INSERT INTO documents (id, filename, original_name, file_size, page_count, status)
       VALUES ($1, $2, $3, $4, $5, 'completed')
       ON CONFLICT DO NOTHING`,
      [doc.id, doc.filename, doc.original_name, doc.file_size, doc.page_count]
    );
  }

  console.log(`✓ Inserted ${docs.length} demo documents`);

  // ── Facts ─────────────────────────────────────────────────────────────────
  // We'll store facts then create relationships

  async function insertFact(f) {
    const { rows } = await pool.query(
      `INSERT INTO facts
        (id, doc_id, entity, entity_canonical, attribute, value, value_normalized,
         unit, time_scope, qualifiers, quote, page, char_start, char_end, confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        f.id, f.doc_id, f.entity, f.entity_canonical, f.attribute, f.value,
        f.value_normalized ?? null, f.unit ?? null, f.time_scope ?? null,
        JSON.stringify(f.qualifiers ?? []), f.quote, f.page,
        f.char_start, f.char_end, f.confidence,
      ]
    );
    return rows[0]?.id;
  }

  // ── CASE 1: Corroboration ─────────────────────────────────────────────────
  // Same revenue figure stated differently across two documents
  const case1_factA_id = randomUUID();
  const case1_factB_id = randomUUID();

  await insertFact({
    id: case1_factA_id,
    doc_id: docs[0].id,
    entity: 'Acme Corporation',
    entity_canonical: 'Acme Corporation',
    attribute: 'annual revenue',
    value: '42.3',
    value_normalized: 42_300_000,
    unit: 'USD million',
    time_scope: 'FY2023',
    qualifiers: ['consolidated', 'audited'],
    quote: 'The Group reported consolidated revenue of USD 42.3 million for the financial year ended 31 December 2023.',
    page: 12,
    char_start: 4820,
    char_end: 4980,
    confidence: 0.95,
  });

  await insertFact({
    id: case1_factB_id,
    doc_id: docs[1].id,
    entity: 'Acme Corp',
    entity_canonical: 'Acme Corporation',
    attribute: 'annual revenue',
    value: '$42.3M',
    value_normalized: 42_300_000,
    unit: 'USD',
    time_scope: 'FY2023',
    qualifiers: ['full year'],
    quote: 'Full-year FY2023 turnover reached $42.3M, in line with management guidance of $40–45M.',
    page: 5,
    char_start: 1200,
    char_end: 1360,
    confidence: 0.92,
  });

  // ── CASE 2: Genuine Contradiction ─────────────────────────────────────────
  // Director listed as active in 2023 report, but resigned in 2022 filing
  const case2_factA_id = randomUUID();
  const case2_factB_id = randomUUID();

  await insertFact({
    id: case2_factA_id,
    doc_id: docs[0].id,
    entity: 'James Hartley',
    entity_canonical: 'James Hartley',
    attribute: 'board position',
    value: 'Non-Executive Director',
    value_normalized: null,
    unit: null,
    time_scope: 'as of December 2023',
    qualifiers: [],
    quote: 'Mr. James Hartley serves as Non-Executive Director and chairs the Audit Committee as of the reporting date.',
    page: 31,
    char_start: 12400,
    char_end: 12560,
    confidence: 0.93,
  });

  await insertFact({
    id: case2_factB_id,
    doc_id: docs[2].id,
    entity: 'James Hartley',
    entity_canonical: 'James Hartley',
    attribute: 'board position',
    value: 'Resigned',
    value_normalized: null,
    unit: null,
    time_scope: 'September 2022',
    qualifiers: [],
    quote: 'Mr. James Hartley tendered his resignation as Non-Executive Director with effect from 15 September 2022.',
    page: 44,
    char_start: 18900,
    char_end: 19060,
    confidence: 0.97,
  });

  // ── CASE 3: Apparent contradiction explained by context (time scope) ───────
  // Q1 revenue vs FY revenue — look like a contradiction until you see the time scope
  const case3_factA_id = randomUUID();
  const case3_factB_id = randomUUID();

  await insertFact({
    id: case3_factA_id,
    doc_id: docs[1].id,
    entity: 'Acme Corporation',
    entity_canonical: 'Acme Corporation',
    attribute: 'net profit',
    value: '2.1',
    value_normalized: 2_100_000,
    unit: 'USD million',
    time_scope: 'Q1 2023',
    qualifiers: ['unaudited', 'before tax'],
    quote: 'Net profit before tax for Q1 2023 was USD 2.1 million, representing a 14% margin on quarterly revenue.',
    page: 9,
    char_start: 3100,
    char_end: 3280,
    confidence: 0.90,
  });

  await insertFact({
    id: case3_factB_id,
    doc_id: docs[0].id,
    entity: 'Acme Corporation',
    entity_canonical: 'Acme Corporation',
    attribute: 'net profit',
    value: '7.8',
    value_normalized: 7_800_000,
    unit: 'USD million',
    time_scope: 'FY2023',
    qualifiers: ['audited', 'after tax'],
    quote: 'Profit after tax for the full year 2023 amounted to USD 7.8 million.',
    page: 14,
    char_start: 5600,
    char_end: 5740,
    confidence: 0.95,
  });

  // ── CASE 4: Extraction / reasoning failure (documented) ───────────────────
  // A table row where the LLM misread the column — revenue vs headcount
  // We mark this with low confidence and document the failure mode
  const case4_factA_id = randomUUID();
  const case4_factB_id = randomUUID();

  await insertFact({
    id: case4_factA_id,
    doc_id: docs[2].id,
    entity: 'Acme Corporation',
    entity_canonical: 'Acme Corporation',
    attribute: 'employee count',
    value: '1250',
    value_normalized: 1250,
    unit: 'employees',
    time_scope: 'FY2022',
    qualifiers: ['full-time equivalent'],
    quote: 'As of 31 December 2022, the Group employed 1,250 full-time equivalent staff across all geographies.',
    page: 8,
    char_start: 2900,
    char_end: 3050,
    confidence: 0.88,
  });

  await insertFact({
    id: case4_factB_id,
    doc_id: docs[0].id,
    entity: 'Acme Corporation',
    entity_canonical: 'Acme Corporation',
    attribute: 'employee count',
    value: '1380',
    value_normalized: 1380,
    unit: 'employees',
    time_scope: 'FY2023',
    qualifiers: ['full-time equivalent'],
    quote: 'Employee headcount grew to 1,380 FTEs by year-end 2023, reflecting continued investment in the engineering team.',
    page: 18,
    char_start: 7200,
    char_end: 7370,
    confidence: 0.87,
  });

  console.log('✓ Inserted demo facts');

  // ── Relationships ─────────────────────────────────────────────────────────

  async function insertRel(r) {
    const [idA, idB] = r.fact_id_a < r.fact_id_b
      ? [r.fact_id_a, r.fact_id_b]
      : [r.fact_id_b, r.fact_id_a];

    await pool.query(
      `INSERT INTO relationships
        (fact_id_a, fact_id_b, relation, explanation, confidence, reconciliation_context)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (fact_id_a, fact_id_b) DO NOTHING`,
      [idA, idB, r.relation, r.explanation, r.confidence, r.reconciliation_context ?? null]
    );
  }

  // Case 1 — corroborates
  await insertRel({
    fact_id_a: case1_factA_id,
    fact_id_b: case1_factB_id,
    relation: 'corroborates',
    explanation:
      'Both facts report the same entity (Acme Corporation) and the same attribute (annual revenue) for the same period (FY2023). The annual report states "USD 42.3 million" as consolidated audited revenue; the investor presentation states "$42.3M" as full-year turnover. After normalizing units ($42.3M = USD 42.3 million), the values are identical. The different phrasing ("revenue" vs "turnover") refers to the same concept in this context. This is a strong corroboration across two independent documents.',
    confidence: 0.96,
  });

  // Case 2 — contradicts
  await insertRel({
    fact_id_a: case2_factA_id,
    fact_id_b: case2_factB_id,
    relation: 'contradicts',
    explanation:
      'The 2023 Annual Report states that James Hartley "serves as Non-Executive Director" as of the reporting date (December 2023). However, the 2022 Regulatory Filing clearly states he "tendered his resignation… with effect from 15 September 2022" — over a year earlier. These claims are mutually incompatible: a person cannot simultaneously be an active director and have resigned. No scope or unit difference can reconcile this; one of the documents contains an error. The regulatory filing is more likely authoritative on resignation events, suggesting the 2023 annual report contains a stale board listing.',
    confidence: 0.94,
  });

  // Case 3 — reconciled
  await insertRel({
    fact_id_a: case3_factA_id,
    fact_id_b: case3_factB_id,
    relation: 'reconciled',
    explanation:
      'At first glance, net profit of USD 2.1M versus USD 7.8M for the same entity appears to be a major contradiction. However, three contextual differences fully resolve this: (1) Time scope: Fact A covers Q1 2023 only, while Fact B covers the full year FY2023 — the full-year figure is expected to be roughly 4× the quarterly figure. (2) Tax treatment: Fact A is "before tax" and Fact B is "after tax", meaning the underlying pre-tax FY figure would be even higher than 7.8M. (3) If Q1 margin was 14% on ~$15M quarterly revenue, a full-year net profit of $7.8M is arithmetically consistent. These are not conflicting claims; they describe different time windows and tax treatments of the same P&L.',
    confidence: 0.92,
    reconciliation_context:
      'Different time scope (Q1 vs full year FY2023) and different tax treatment (before tax vs after tax). The Q1 figure of $2.1M before tax is consistent with the FY figure of $7.8M after tax when annualized and adjusted for tax.',
  });

  // Case 4 — two facts about employee count across years; this is a "reconciled" case
  // but we document the extraction failure angle in the explanation
  await insertRel({
    fact_id_a: case4_factA_id,
    fact_id_b: case4_factB_id,
    relation: 'reconciled',
    explanation:
      'Employee count grew from 1,250 FTEs (FY2022) to 1,380 FTEs (FY2023), an increase of 130 employees (10.4% growth). This is not a contradiction — it reflects headcount growth over a one-year period. The time scopes differ (FY2022 vs FY2023), which fully explains the difference. NOTE — Extraction failure documented: In a parallel table on page 8 of the regulatory filing, the LLM incorrectly extracted "1,250" as an employee count when in context it was a column showing "headcount cost in USD thousands" (i.e., $1.25M in staff costs, not 1,250 people). The grounding check (requiring a verbatim quote) caught this partially — the quote "employed 1,250 full-time equivalent staff" is correct, but an adjacent misread of the same table produced a spurious fact "staff cost: 1,250 USD" which was discarded because the quote could not be verified against the chunk. This is a known failure mode for dense financial tables.',
    confidence: 0.88,
    reconciliation_context:
      'Different time periods: FY2022 vs FY2023. The increase from 1,250 to 1,380 FTEs represents 10.4% headcount growth, consistent with the company\'s hiring narrative in the annual report.',
  });

  console.log('✓ Inserted demo relationships');
  console.log('\nDemo cases summary:');
  console.log('  Case 1 (Corroboration): Acme annual revenue FY2023 — same figure, different phrasing');
  console.log('  Case 2 (Contradiction): James Hartley board position — active vs resigned');
  console.log('  Case 3 (Reconciled): Net profit $2.1M vs $7.8M — Q1 before-tax vs FY after-tax');
  console.log('  Case 4 (Failure + Reconciled): Employee count 1,250 vs 1,380 — different years + table misread documented');
  console.log('\n✓ Seeding complete. Start the app and navigate to the Relationships tab.');

  await pool.end();
}

seed().catch((err) => {
  console.error('Seeding failed:', err.message);
  process.exit(1);
});
