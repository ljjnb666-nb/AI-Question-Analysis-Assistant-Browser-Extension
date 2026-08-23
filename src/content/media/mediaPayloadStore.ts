export type MediaPayload = {
  sourceUrl?: string;
  dataUrl?: string;
  blob?: Blob;
  serializedSvg?: string;
  mimeType?: string;
  /** Object URL created by this store, never a page-owned blob source URL. */
  ownedObjectUrl?: string;
};

type StoredPayload = MediaPayload & { bytes: number };

/** Ephemeral, bounded content-script payload store. Never serialize this object. */
export class MediaPayloadStore {
  private readonly entries = new Map<string, StoredPayload>();
  private totalBytes = 0;

  constructor(
    readonly maxEntries = 32,
    readonly maxBytes = 8 * 1024 * 1024,
    readonly maxSingleAssetBytes = 2 * 1024 * 1024,
  ) {}

  put(assetId: string, payload: MediaPayload): boolean {
    const bytes = estimatePayloadBytes(payload);
    if (bytes > this.maxSingleAssetBytes || bytes > this.maxBytes) return false;
    this.delete(assetId);
    while (this.entries.size >= this.maxEntries || this.totalBytes + bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.delete(oldest);
    }
    if (this.totalBytes + bytes > this.maxBytes) return false;
    this.entries.set(assetId, { ...payload, bytes });
    this.totalBytes += bytes;
    return true;
  }

  get(assetId: string): MediaPayload | undefined {
    const value = this.entries.get(assetId);
    if (!value) return undefined;
    this.entries.delete(assetId);
    this.entries.set(assetId, value);
    const { bytes: _bytes, ...payload } = value;
    return payload;
  }
  has(assetId: string): boolean { return this.entries.has(assetId); }
  delete(assetId: string): boolean {
    const value = this.entries.get(assetId);
    if (!value) return false;
    if (value.ownedObjectUrl) URL.revokeObjectURL(value.ownedObjectUrl);
    this.totalBytes -= value.bytes;
    return this.entries.delete(assetId);
  }
  clear(): void { Array.from(this.entries.keys()).forEach((id) => this.delete(id)); }
  get size(): number { return this.entries.size; }
  get bytes(): number { return this.totalBytes; }
}

function estimatePayloadBytes(payload: MediaPayload): number {
  const text = `${payload.dataUrl ?? ""}${payload.serializedSvg ?? ""}${payload.sourceUrl ?? ""}`;
  return new TextEncoder().encode(text).byteLength + (payload.blob?.size ?? 0);
}

export const runtimeMediaPayloadStore = new MediaPayloadStore();
