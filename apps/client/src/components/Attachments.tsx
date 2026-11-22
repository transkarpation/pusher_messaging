import { useEffect, useState } from "react";
import { isInlineImage, type Attachment } from "@pm/shared";
import { formatSize } from "../lib/files";

interface Item {
  key: string | number;
  name: string;
  size: number;
  contentType: string;
  url: string;
}

/** Pictures as thumbnails (open full size in a new tab), other files as download cards. */
function AttachmentList({ items }: { items: Item[] }) {
  const images = items.filter((i) => isInlineImage(i.contentType));
  const files = items.filter((i) => !isInlineImage(i.contentType));
  return (
    <div className="attachments" onClick={(e) => e.stopPropagation()}>
      {images.length > 0 && (
        <div className={`attachment-images ${images.length === 1 ? "single" : ""}`}>
          {images.map((i) => (
            <a key={i.key} href={i.url} target="_blank" rel="noreferrer" title={i.name}>
              <img src={i.url} alt={i.name} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {files.map((i) => (
        <a key={i.key} className="attachment-file" href={i.url} download={i.name} title={`Download ${i.name}`}>
          <span className="attachment-icon" aria-hidden="true">
            📄
          </span>
          <span className="attachment-info">
            <span className="attachment-name">{i.name}</span>
            <span className="attachment-size">{formatSize(i.size)}</span>
          </span>
        </a>
      ))}
    </div>
  );
}

export function MessageAttachments({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  return <AttachmentList items={attachments.map((a) => ({ ...a, key: a.id }))} />;
}

/** Local object URLs for files, revoked when the files change or the component unmounts. */
function useObjectUrls(files: File[]): (string | undefined)[] {
  const [urls, setUrls] = useState<{ files: File[]; urls: string[] }>({ files: [], urls: [] });
  useEffect(() => {
    const next = files.map((f) => URL.createObjectURL(f));
    setUrls({ files, urls: next });
    return () => next.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  // Until the effect runs for new files, don't hand out URLs made for the old ones.
  return urls.files === files ? urls.urls : [];
}

/** Files of a message that's still being sent, shown from the local copies. */
export function PendingAttachments({ files }: { files: File[] }) {
  const urls = useObjectUrls(files);
  if (files.length === 0) return null;
  if (urls.length === 0) return null;
  return (
    <AttachmentList
      items={files.map((f, i) => ({
        key: i,
        name: f.name,
        size: f.size,
        contentType: f.type,
        url: urls[i]!,
      }))}
    />
  );
}

/** Files picked in the composer, before sending; each can be removed. */
export function DraftAttachments({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  const urls = useObjectUrls(files);
  if (files.length === 0) return null;
  return (
    <ul className="draft-attachments" aria-label="Files to send">
      {files.map((f, i) => (
        <li key={`${i}-${f.name}-${f.size}`} className="draft-attachment">
          {isInlineImage(f.type) && urls[i] ? (
            <img src={urls[i]} alt="" />
          ) : (
            <span className="attachment-icon" aria-hidden="true">
              📄
            </span>
          )}
          <span className="attachment-info">
            <span className="attachment-name">{f.name}</span>
            <span className="attachment-size">{formatSize(f.size)}</span>
          </span>
          <button type="button" className="ghost icon" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => onRemove(i)}>
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
