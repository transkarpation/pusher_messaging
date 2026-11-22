import {
  ATTACHMENT_MAX_BYTES,
  WAVEFORM_BARS,
  WAVEFORM_MAX,
  isInlineAudio,
  isInlineMedia,
  type Attachment,
} from "@pm/shared";
import { badRequest, notFound } from "../../shared/errors.js";
import type { Actor } from "../../shared/http.js";
import type { AttachmentRow, AttachmentsRepository } from "./attachments.repository.js";

/** Uploads not sent with a message within this long are cleaned up on the uploader's next upload. */
const UNSENT_TTL_MS = 24 * 60 * 60 * 1000;

export const attachmentUrl = (a: Pick<AttachmentRow, "id" | "roomId">) => `/api/rooms/${a.roomId}/attachments/${a.id}`;

export const toAttachment = (a: AttachmentRow): Attachment => ({
  id: a.id,
  name: a.name,
  size: a.size,
  contentType: a.contentType,
  url: attachmentUrl(a),
  durationMs: a.durationMs,
  waveform: a.waveform,
});

/** A duration header: whole ms up to an hour, else null. */
function parseDuration(raw: string | undefined): number | null {
  const ms = Number(raw);
  return raw && Number.isInteger(ms) && ms > 0 && ms <= 60 * 60 * 1000 ? ms : null;
}

/** A waveform header: exactly `WAVEFORM_BARS` integers 0–`WAVEFORM_MAX`, else null. */
function parseWaveform(raw: string | undefined): number[] | null {
  if (!raw) return null;
  const levels = raw.split(",").map(Number);
  const valid = levels.length === WAVEFORM_BARS && levels.every((l) => Number.isInteger(l) && l >= 0 && l <= WAVEFORM_MAX);
  return valid ? levels : null;
}

/** A file name safe to store and show: no path, no control characters, at most 255 characters. */
export function cleanFileName(raw: string | undefined): string {
  let name = "";
  try {
    name = decodeURIComponent(raw ?? "");
  } catch {
    name = raw ?? "";
  }
  name = name
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return [...name].slice(0, 255).join("") || "file";
}

/** A MIME type to store: lowercased, without parameters, or a generic binary type. */
function cleanContentType(raw: string | undefined): string {
  const type = (raw ?? "").split(";")[0]!.trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type) && type.length <= 127 ? type : "application/octet-stream";
}

/** Files attached to messages in a room the actor belongs to (checked at the HTTP edge). */
export class AttachmentsService {
  constructor(private readonly attachments: AttachmentsRepository) {}

  /** Stores an upload; it's linked to a message when one is sent with its id. */
  /** `durationMs` and `waveform` (raw header values) are kept for audio only, when valid. */
  async upload(
    actor: Actor,
    roomId: number,
    file: { data: unknown; name?: string; contentType?: string; durationMs?: string; waveform?: string },
  ): Promise<Attachment> {
    if (!Buffer.isBuffer(file.data) || file.data.length === 0) throw badRequest("The file is empty");
    if (file.data.length > ATTACHMENT_MAX_BYTES) throw badRequest("The file is too large");
    await this.attachments.deleteUnsent(actor.user.id, new Date(Date.now() - UNSENT_TTL_MS));
    const contentType = cleanContentType(file.contentType);
    const audio = isInlineAudio(contentType);
    const row = await this.attachments.create({
      roomId,
      uploaderId: actor.user.id,
      name: cleanFileName(file.name),
      contentType,
      durationMs: audio ? parseDuration(file.durationMs) : null,
      waveform: audio ? parseWaveform(file.waveform) : null,
      data: file.data,
    });
    return toAttachment(row);
  }

  /** The file, with whether it's safe to show inline (a raster image or audio) rather than download. */
  async download(viewerId: number, roomId: number, id: number) {
    const file = await this.attachments.findVisible(roomId, id, viewerId);
    if (!file) throw notFound("Attachment not found");
    return { ...file, inline: isInlineMedia(file.contentType) };
  }
}
