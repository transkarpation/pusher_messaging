import { ATTACHMENT_MAX_BYTES, ATTACHMENTS_PER_MESSAGE, isInlineImage, type Attachment } from "@pm/shared";

/** "512 B", "34 KB", "2.4 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} MB`;
}

/** Short description of a message's files for previews: "📷 Photo", "📎 report.pdf", "📎 3 files". */
export function attachmentSummary(attachments: Pick<Attachment, "name" | "contentType">[]): string {
  if (attachments.length === 0) return "";
  if (attachments.every((a) => isInlineImage(a.contentType))) {
    return attachments.length === 1 ? "📷 Photo" : `📷 ${attachments.length} photos`;
  }
  return attachments.length === 1 ? `📎 ${attachments[0]!.name}` : `📎 ${attachments.length} files`;
}

/**
 * Adds picked files to the draft, keeping to the per-message count and size limits.
 * Returns the new list and, if some files were left out, why.
 */
export function addFiles(current: File[], picked: File[]): { files: File[]; error: string | null } {
  const tooBig = picked.filter((f) => f.size > ATTACHMENT_MAX_BYTES);
  const empty = picked.filter((f) => f.size === 0);
  const ok = picked.filter((f) => f.size > 0 && f.size <= ATTACHMENT_MAX_BYTES);
  const room = ATTACHMENTS_PER_MESSAGE - current.length;
  const files = [...current, ...ok.slice(0, Math.max(0, room))];
  const limitMb = ATTACHMENT_MAX_BYTES / 1024 / 1024;
  const error =
    tooBig.length > 0
      ? `${tooBig.map((f) => f.name).join(", ")}: larger than ${limitMb} MB`
      : ok.length > room
        ? `At most ${ATTACHMENTS_PER_MESSAGE} files per message`
        : empty.length > 0
          ? `${empty.map((f) => f.name).join(", ")}: the file is empty`
          : null;
  return { files, error };
}
