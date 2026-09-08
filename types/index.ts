// ─── Document ────────────────────────────────────────────────────────────────

export interface Document {
  id: string;
  filename: string;
  original_name: string;
  file_size: number;
  page_count: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error_message?: string;
  created_at: string;
  updated_at: string;
  fact_count?: number;
}

// ─── Chunk ────────────────────────────────────────────────────────────────────

export interface Chunk {
  doc_id: string;
  page: number;
  chunk_index: number;
  text: string;
  char_start: number;
  char_end: number;
}

// ─── Fact ────────────────────────────────────────────────────────────────────

export interface FactSource {
  doc_id: string;
  doc_name: string;
  page: number;
  char_start: number;
  char_end: number;
  quote: string;
}

export interface Fact {
  id: string;
  doc_id: string;
  entity: string;
  entity_canonical: string;
  attribute: string;
  value: string;
  value_normalized?: number | null;
  unit?: string;
  time_scope?: string;
  qualifiers: string[];
  quote: string;
  page: number;
  char_start: number;
  char_end: number;
  confidence: number;
  source?: FactSource;
  created_at: string;
}

// ─── Relationship ─────────────────────────────────────────────────────────────

export type RelationType = 'corroborates' | 'contradicts' | 'reconciled' | 'unrelated';

export interface Relationship {
  id: string;
  fact_id_a: string;
  fact_id_b: string;
  relation: RelationType;
  explanation: string;
  confidence: number;
  reconciliation_context?: string;
  created_at: string;
  // Joined fields
  fact_a?: Fact;
  fact_b?: Fact;
}

// ─── API Responses ───────────────────────────────────────────────────────────

export interface UploadResponse {
  doc_id: string;
  filename: string;
  message: string;
}

export interface ProcessResponse {
  doc_id: string;
  facts_extracted: number;
  relationships_found: number;
  message: string;
}

export interface FactsResponse {
  facts: Fact[];
  total: number;
  page: number;
  page_size: number;
}

export interface RelationshipsResponse {
  relationships: Relationship[];
  total: number;
  summary: {
    corroborates: number;
    contradicts: number;
    reconciled: number;
  };
}

// ─── LLM Schemas ─────────────────────────────────────────────────────────────

export interface ExtractedFact {
  entity: string;
  attribute: string;
  value: string;
  unit?: string;
  time_scope?: string;
  qualifiers: string[];
  quote: string;
  confidence: number;
}

export interface ComparisonResult {
  relation: RelationType;
  explanation: string;
  confidence: number;
  reconciliation_context?: string;
}
