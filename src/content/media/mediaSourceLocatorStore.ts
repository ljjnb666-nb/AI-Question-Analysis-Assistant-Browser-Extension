export type MediaSourceLocator = { sourceUrl: string };

/** Bounded, runtime-only source locator cache. It never crosses a serialization boundary. */
export class MediaSourceLocatorStore {
  private readonly entries = new Map<string, MediaSourceLocator>();
  constructor(readonly maxEntries = 128) {}
  put(assetId: string, locator: MediaSourceLocator): void {
    this.entries.delete(assetId);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
    this.entries.set(assetId, locator);
  }
  get(assetId: string): MediaSourceLocator | undefined {
    const locator = this.entries.get(assetId);
    if (!locator) return undefined;
    this.entries.delete(assetId);
    this.entries.set(assetId, locator);
    return locator;
  }
  has(assetId: string): boolean { return this.entries.has(assetId); }
  delete(assetId: string): boolean { return this.entries.delete(assetId); }
  clear(): void { this.entries.clear(); }
  get size(): number { return this.entries.size; }
}

export const runtimeMediaSourceLocatorStore = new MediaSourceLocatorStore();
