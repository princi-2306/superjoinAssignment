import mongoose, { Schema, Document as MongoDoc, Types } from "mongoose";

// ── User ──────────────────────────────────────────────────────────────────────

export interface IUser extends MongoDoc {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

UserSchema.index({ email: 1 }, { unique: true });

// ── Document ──────────────────────────────────────────────────────────────────

export interface IDocument extends MongoDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;          // owner
  filename: string;
  originalName: string;
  fileSize: number;
  pageCount: number;
  contentHash: string;
  status: "pending" | "processing" | "completed" | "failed";
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DocumentSchema = new Schema<IDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    fileSize: { type: Number, required: true },
    pageCount: { type: Number, default: 0 },
    // Hash is scoped per-user so two users can upload the same PDF independently
    contentHash: { type: String },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },
    errorMessage: { type: String },
  },
  { timestamps: true }
);

// Dedup: same user cannot upload the same file twice
DocumentSchema.index({ userId: 1, contentHash: 1 }, { unique: true, sparse: true });

// ── Chunk ─────────────────────────────────────────────────────────────────────

export interface IChunk extends MongoDoc {
  _id: Types.ObjectId;
  docId: Types.ObjectId;
  userId: Types.ObjectId;
  page: number;
  chunkIndex: number;
  text: string;
  charStart: number;
  charEnd: number;
  createdAt: Date;
}

const ChunkSchema = new Schema<IChunk>(
  {
    docId:  { type: Schema.Types.ObjectId, ref: "Document", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User",     required: true, index: true },
    page:       { type: Number, required: true },
    chunkIndex: { type: Number, required: true },
    text:       { type: String, required: true },
    charStart:  { type: Number, required: true },
    charEnd:    { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// ── Fact ──────────────────────────────────────────────────────────────────────

export interface IFact extends MongoDoc {
  _id: Types.ObjectId;
  docId:   Types.ObjectId;
  userId:  Types.ObjectId;          // owner — used for cross-doc scoping
  entity: string;
  entityCanonical: string;
  attribute: string;
  value: string;
  valueNormalized?: number;
  unit?: string;
  timeScope?: string;
  qualifiers: string[];
  quote: string;
  page: number;
  charStart: number;
  charEnd: number;
  confidence: number;
  createdAt: Date;
}

const FactSchema = new Schema<IFact>(
  {
    docId:  { type: Schema.Types.ObjectId, ref: "Document", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User",     required: true, index: true },
    entity:          { type: String, required: true },
    entityCanonical: { type: String, required: true },
    attribute:       { type: String, required: true },
    value:           { type: String, required: true },
    valueNormalized: { type: Number },
    unit:       { type: String },
    timeScope:  { type: String },
    qualifiers: { type: [String], default: [] },
    quote:      { type: String, required: true },
    page:       { type: Number, required: true },
    charStart:  { type: Number, required: true },
    charEnd:    { type: Number, required: true },
    confidence: { type: Number, default: 0.8 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Candidate retrieval: match entity+attribute within the same user's knowledge base
FactSchema.index({ userId: 1, entityCanonical: 1, attribute: 1 });
FactSchema.index({ userId: 1, attribute: 1 });

// ── Relationship ──────────────────────────────────────────────────────────────

export interface IRelationship extends MongoDoc {
  _id: Types.ObjectId;
  userId:   Types.ObjectId;          // owner
  factIdA:  Types.ObjectId;
  factIdB:  Types.ObjectId;
  relation: "corroborates" | "contradicts" | "reconciled" | "unrelated";
  explanation: string;
  confidence: number;
  reconciliationContext?: string;
  createdAt: Date;
}

const RelationshipSchema = new Schema<IRelationship>(
  {
    userId:  { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    factIdA: { type: Schema.Types.ObjectId, ref: "Fact", required: true, index: true },
    factIdB: { type: Schema.Types.ObjectId, ref: "Fact", required: true, index: true },
    relation: {
      type: String,
      enum: ["corroborates", "contradicts", "reconciled", "unrelated"],
      required: true,
      index: true,
    },
    explanation:           { type: String, required: true },
    confidence:            { type: Number, default: 0.8 },
    reconciliationContext: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Pair uniqueness scoped per user
RelationshipSchema.index({ userId: 1, factIdA: 1, factIdB: 1 }, { unique: true });

// ── Model registration (safe for Next.js hot-reload) ──────────────────────────

export const UserModel =
  (mongoose.models.User as mongoose.Model<IUser>) ||
  mongoose.model<IUser>("User", UserSchema);

export const DocumentModel =
  (mongoose.models.Document as mongoose.Model<IDocument>) ||
  mongoose.model<IDocument>("Document", DocumentSchema);

export const ChunkModel =
  (mongoose.models.Chunk as mongoose.Model<IChunk>) ||
  mongoose.model<IChunk>("Chunk", ChunkSchema);

export const FactModel =
  (mongoose.models.Fact as mongoose.Model<IFact>) ||
  mongoose.model<IFact>("Fact", FactSchema);

export const RelationshipModel =
  (mongoose.models.Relationship as mongoose.Model<IRelationship>) ||
  mongoose.model<IRelationship>("Relationship", RelationshipSchema);
