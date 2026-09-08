'use client';

import { Document } from '@/types';

interface DocumentListProps {
  documents: Document[];
  loading: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function DocumentList({ documents, loading }: DocumentListProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card p-4 animate-pulse">
            <div className="h-4 bg-[var(--muted)] rounded w-1/2 mb-2" />
            <div className="h-3 bg-[var(--muted)] rounded w-1/3" />
          </div>
        ))}
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="text-center py-10 text-[var(--muted-foreground)]">
        <div className="text-3xl mb-2">📭</div>
        <p>No documents yet. Upload PDFs to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {documents.map((doc) => (
        <div key={doc.id} className="card p-4 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[var(--muted)] flex items-center justify-center text-lg flex-shrink-0 mt-0.5">
              📄
            </div>
            <div className="min-w-0">
              <p className="font-medium truncate text-[var(--foreground)]">{doc.original_name}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-[var(--muted-foreground)]">
                <span>{doc.page_count} pages</span>
                <span>·</span>
                <span>{formatBytes(doc.file_size)}</span>
                <span>·</span>
                <span>{doc.fact_count ?? 0} facts</span>
                <span>·</span>
                <span>{formatDate(doc.created_at)}</span>
              </div>
              {doc.error_message && (
                <p className="text-xs text-red-400 mt-1 truncate">{doc.error_message}</p>
              )}
            </div>
          </div>

          <div className="flex-shrink-0">
            <span className={`badge-${doc.status}`}>
              {doc.status === 'processing' && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse-glow" />
              )}
              {doc.status}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
