'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';

interface UploadResult {
  doc_id?: string;
  filename: string;
  facts_extracted?: number;
  relationships_found?: number;
  skipped_duplicate?: boolean;
  message?: string;
  error?: string;
}

interface UploadZoneProps {
  onUploadComplete: () => void;
}

export default function UploadZone({ onUploadComplete }: UploadZoneProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;

      setUploading(true);
      setProgress([`Uploading ${acceptedFiles.length} file(s)...`]);

      const formData = new FormData();
      for (const file of acceptedFiles) {
        formData.append('files', file);
      }

      try {
        setProgress((p) => [...p, 'Parsing PDFs and extracting chunks...']);

        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error ?? 'Upload failed');
        }

        const results: UploadResult[] = data.results;
        const logs: string[] = [];

        for (const r of results) {
          if (r.error) {
            logs.push(`✗ ${r.filename}: ${r.error}`);
            toast.error(`Failed: ${r.filename}`);
          } else if (r.skipped_duplicate) {
            logs.push(`⟳ ${r.filename}: already in knowledge layer`);
            toast(`Skipped duplicate: ${r.filename}`, { icon: '⟳' });
          } else {
            logs.push(
              `✓ ${r.filename}: ${r.facts_extracted} facts, ${r.relationships_found} relationships`
            );
            toast.success(`Processed: ${r.filename}`);
          }
        }

        setProgress((p) => [...p, ...logs, 'Done!']);
        onUploadComplete();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        toast.error(msg);
        setProgress((p) => [...p, `Error: ${msg}`]);
      } finally {
        setUploading(false);
        setTimeout(() => setProgress([]), 8000);
      }
    },
    [onUploadComplete]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
    disabled: uploading,
  });

  return (
    <div className="space-y-3">
      <div
        {...getRootProps()}
        className={`
          relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-200
          ${isDragActive
            ? 'border-[var(--primary)] bg-[var(--primary)]/5'
            : 'border-[var(--card-border)] hover:border-[var(--primary)]/50 hover:bg-[var(--primary)]/3'
          }
          ${uploading ? 'opacity-60 cursor-not-allowed' : ''}
        `}
      >
        <input {...getInputProps()} />

        <div className="flex flex-col items-center gap-3">
          <div className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl
            ${isDragActive ? 'bg-[var(--primary)]/20' : 'bg-[var(--muted)]'}
          `}>
            {uploading ? '⏳' : isDragActive ? '📂' : '📄'}
          </div>

          {uploading ? (
            <div className="text-[var(--muted-foreground)]">
              <div className="flex items-center gap-2 justify-center">
                <span className="inline-block w-2 h-2 rounded-full bg-[var(--primary)] animate-pulse-glow" />
                Processing document...
              </div>
              <p className="text-xs mt-1">This may take 1–3 minutes depending on document size</p>
            </div>
          ) : (
            <div>
              <p className="font-medium text-[var(--foreground)]">
                {isDragActive ? 'Drop PDFs here' : 'Drop PDFs here or click to browse'}
              </p>
              <p className="text-xs text-[var(--muted-foreground)] mt-1">
                Supports multiple PDFs · Duplicates are auto-skipped
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Progress log */}
      {progress.length > 0 && (
        <div className="card p-3 font-mono text-xs space-y-1 max-h-40 overflow-y-auto">
          {progress.map((line, i) => (
            <div
              key={i}
              className={`
                ${line.startsWith('✓') ? 'text-green-400' : ''}
                ${line.startsWith('✗') ? 'text-red-400' : ''}
                ${line.startsWith('⟳') ? 'text-yellow-400' : ''}
                ${line === 'Done!' ? 'text-[var(--primary)] font-bold' : ''}
                ${!line.startsWith('✓') && !line.startsWith('✗') && !line.startsWith('⟳') && line !== 'Done!'
                  ? 'text-[var(--muted-foreground)]' : ''}
              `}
            >
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
