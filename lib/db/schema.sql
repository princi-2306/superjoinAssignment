-- Enable pgcrypto for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Documents ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename      TEXT NOT NULL,          -- stored filename (uuid-based)
  original_name TEXT NOT NULL,          -- original upload name
  file_size     BIGINT NOT NULL,
  page_count    INT NOT NULL DEFAULT 0,
  content_hash  TEXT,                   -- SHA256 for dedup
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_hash) WHERE content_hash IS NOT NULL;

-- ─── Chunks ──────────────────────────────────────────────────────────────────
-- Stores raw chunks for provenance / re-extraction without re-parsing
CREATE TABLE IF NOT EXISTS chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id      UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page        INT NOT NULL,
  chunk_index INT NOT NULL,
  text        TEXT NOT NULL,
  char_start  INT NOT NULL,
  char_end    INT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(doc_id);

-- ─── Facts ───────────────────────────────────────────────────────────────────
-- JSONB qualifiers so the schema evolves dynamically with new fact types
CREATE TABLE IF NOT EXISTS facts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id           UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  entity           TEXT NOT NULL,         -- raw entity name from LLM
  entity_canonical TEXT NOT NULL,         -- normalized canonical name
  attribute        TEXT NOT NULL,         -- e.g. "annual revenue", "director name"
  value            TEXT NOT NULL,         -- raw string value
  value_normalized NUMERIC,              -- parsed numeric value if applicable
  unit             TEXT,                  -- "USD million", "%" etc.
  time_scope       TEXT,                  -- "FY2023", "Q1 2024", "as of Jan 2023"
  qualifiers       JSONB NOT NULL DEFAULT '[]',  -- ["consolidated","unaudited"]
  quote            TEXT NOT NULL,         -- verbatim excerpt from source
  page             INT NOT NULL,
  char_start       INT NOT NULL,
  char_end         INT NOT NULL,
  confidence       FLOAT NOT NULL DEFAULT 0.8,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_facts_doc_id ON facts(doc_id);
CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity_canonical);
CREATE INDEX IF NOT EXISTS idx_facts_attribute ON facts(attribute);
CREATE INDEX IF NOT EXISTS idx_facts_entity_attr ON facts(entity_canonical, attribute);

-- ─── Relationships ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS relationships (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_id_a              UUID NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
  fact_id_b              UUID NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
  relation               TEXT NOT NULL
                           CHECK (relation IN ('corroborates', 'contradicts', 'reconciled', 'unrelated')),
  explanation            TEXT NOT NULL,
  confidence             FLOAT NOT NULL DEFAULT 0.8,
  reconciliation_context TEXT,           -- time/scope/unit explanation for reconciled
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT no_self_relation CHECK (fact_id_a <> fact_id_b),
  CONSTRAINT ordered_pair UNIQUE (fact_id_a, fact_id_b)  -- avoid duplicate pairs
);

CREATE INDEX IF NOT EXISTS idx_relationships_fact_a ON relationships(fact_id_a);
CREATE INDEX IF NOT EXISTS idx_relationships_fact_b ON relationships(fact_id_b);
CREATE INDEX IF NOT EXISTS idx_relationships_relation ON relationships(relation);
