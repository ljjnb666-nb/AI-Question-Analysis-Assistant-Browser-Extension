/** DOM type guards that use each node's own browsing-context constructors. */
type RealmConstructors = Record<string, unknown>;

function isInstanceInOwnerRealm(value: unknown, constructorName: string): boolean {
  if (!value || typeof value !== "object") return false;
  const node = value as Node;
  if (node.nodeType !== 1) return false;
  const ownerDocument = (value as Element).ownerDocument;
  const view = ownerDocument?.defaultView as unknown as RealmConstructors | null;
  const Constructor = view?.[constructorName];
  return typeof Constructor === "function" && value instanceof (Constructor as abstract new (...args: never[]) => object);
}

export function isElementInOwnerRealm(value: unknown): value is Element {
  return isInstanceInOwnerRealm(value, "Element");
}

export function isHTMLElementInOwnerRealm(value: unknown): value is HTMLElement {
  return isInstanceInOwnerRealm(value, "HTMLElement");
}

export function isHTMLInputInOwnerRealm(value: unknown): value is HTMLInputElement {
  return isInstanceInOwnerRealm(value, "HTMLInputElement") && (value as Element).tagName === "INPUT";
}

export function isHTMLTextAreaInOwnerRealm(value: unknown): value is HTMLTextAreaElement {
  return isInstanceInOwnerRealm(value, "HTMLTextAreaElement") && (value as Element).tagName === "TEXTAREA";
}

export function isHTMLIFrameInOwnerRealm(value: unknown): value is HTMLIFrameElement {
  return isInstanceInOwnerRealm(value, "HTMLIFrameElement") && (value as Element).tagName === "IFRAME";
}

export function isDocumentNode(value: unknown): value is Document {
  if (!value || typeof value !== "object" || (value as Node).nodeType !== 9) return false;
  const doc = value as Document;
  const Constructor = (doc.defaultView as unknown as RealmConstructors | null)?.Document;
  return typeof Constructor === "function" && value instanceof (Constructor as abstract new (...args: never[]) => object);
}

export function isOpenShadowRootNode(value: unknown): value is ShadowRoot {
  if (!value || typeof value !== "object" || (value as Node).nodeType !== 11) return false;
  const root = value as ShadowRoot;
  const Constructor = (root.host?.ownerDocument.defaultView as unknown as RealmConstructors | null)?.ShadowRoot;
  return typeof Constructor === "function"
    && value instanceof (Constructor as abstract new (...args: never[]) => object)
    && root.host.shadowRoot === root;
}
