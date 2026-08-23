/** Serializable metadata only. Payload bytes remain in the content-runtime store. */
export type MediaAssetKind = "image" | "svg" | "canvas" | "background-image";
export type MediaSourceKind = "img-src" | "img-current-src" | "picture" | "lazy-src" | "data-url" | "blob-url" | "css-background" | "inline-svg" | "canvas-snapshot";
export type MediaOwnershipRole = "stem" | "option" | "shared-context-candidate" | "decoration" | "unknown";
export type MediaAvailability = "available" | "url-only" | "pending" | "blocked" | "tainted" | "unresolved";

export type MediaOwnershipReason =
  | "OPTION_ANCESTRY"
  | "STEM_ANCESTRY"
  | "SAME_QUESTION_OWNER"
  | "CAPTION_OR_LABEL"
  | "GEOMETRY_SUPPORT"
  | "DECORATIVE"
  | "FORMULA_REPRESENTATION"
  | "CROSS_QUESTION_OWNER"
  | "AMBIGUOUS_OWNER";

export interface MediaOwnership {
  role: MediaOwnershipRole;
  optionKey?: string;
  confidence: number;
  reasons: MediaOwnershipReason[];
}

export interface MediaAssetRef {
  schemaVersion: 1;
  assetId: string;
  contentFingerprint: string;
  kind: MediaAssetKind;
  sourceKind: MediaSourceKind;
  availability: MediaAvailability;
  mimeType?: string;
  width?: number;
  height?: number;
  altText?: string;
  ariaLabel?: string;
  captionText?: string;
  semanticOrder?: number;
  ownership: MediaOwnership;
}

export type MediaFingerprintHint = Pick<MediaAssetRef, "contentFingerprint" | "semanticOrder"> & {
  role: MediaOwnershipRole;
  optionKey?: string;
};
