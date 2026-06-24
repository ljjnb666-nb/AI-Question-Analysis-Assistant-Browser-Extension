const PLACEHOLDER_GLYPH_MAP = new Map<string, string>([
  ["\u80c3", "\u03b8"],
  ["\u8805", "\u03c9"],
  ["\u87fd", "\u03c3"],
  ["\u8802", "\u03c7"],
  ["\u6e2d", "\u03bc"],
  ["\u4f4d", "\u03bb"],
  ["\u8801", "\u03c6"],
  ["\u8804", "\u03c8"],
  ["\u87fa", "\u03c0"],
  ["\u87ff", "\u03c4"],
]);

export function normalizeFormulaPlaceholderGlyphs(text: string): string {
  const source = String(text || "");
  if (!source) return "";

  const chars = Array.from(source);
  return chars
    .map((char, index) => {
      const mapped = PLACEHOLDER_GLYPH_MAP.get(char);
      if (!mapped) return char;
      return shouldRewritePlaceholderGlyph(chars, index) ? mapped : char;
    })
    .join("");
}

function shouldRewritePlaceholderGlyph(chars: string[], index: number): boolean {
  const prev = chars[index - 1] || "";
  const next = chars[index + 1] || "";
  const prev2 = chars[index - 2] || "";
  const next2 = chars[index + 2] || "";

  const adjacent = `${prev}${next}${prev2}${next2}`;
  if (!adjacent.trim()) return true;
  if (/[=+\-*/^_(){}\[\],.;:<>]/.test(adjacent)) return true;
  if (/[0-9A-Za-z]/.test(adjacent)) return true;
  if (/[胃蠅蟽蠂渭位蠁蠄蟺蟿XYZxyz]/u.test(adjacent)) return true;

  const prevIsCjk = /[\u4e00-\u9fff]/u.test(prev);
  const nextIsCjk = /[\u4e00-\u9fff]/u.test(next);
  if (prevIsCjk && nextIsCjk) return false;

  return prevIsCjk !== nextIsCjk ? false : true;
}

export function normalizeMathDisplayText(text: string): string {
  let out = normalizeFormulaPlaceholderGlyphs(String(text || ""));
  if (!out) return "";

  out = out
    .replace(/\uFFFD/g, "")
    .replace(/锟/g, "-")
    .replace(/&infin;|&#8734;|\\infty/gi, "\u221e")
    .replace(/\u8d1f\u65e0\u7a77/g, "-\u221e")
    .replace(/\u6b63\u65e0\u7a77/g, "+\u221e")
    .replace(/&omega;|&#969;|\\omega/gi, "\u03c9")
    .replace(/&sigma;|&#963;|\\sigma/gi, "\u03c3")
    .replace(/&minus;|&#8722;/gi, "-")
    .replace(/[\u2212\ufe63\uff0d]/g, "-")
    .replace(/[\uff0b\ufe62]/g, "+")
    .replace(/\b([+-])\s*infty\b/gi, "$1\u221e")
    .replace(/\binfty\b/gi, "\u221e")
    .replace(/\u7531\s*-\s*(?:\u221e)?\s*\u5230\s*\+\s*(?:\u221e)?/g, "\u7531-\u221e\u5230+\u221e")
    .replace(/\u4ece\s*-\s*(?:\u221e)?\s*\u5230\s*\+\s*(?:\u221e)?/g, "\u4ece-\u221e\u5230+\u221e");

  out = out.replace(
    /((?:\u03c9|w|omega)[^\u3002\uff1b;,.锛孿n]{0,24}?\u7531)\s*-\s*(?:\u221e)?\s*\u5230\s*\+\s*(?:\u221e)?/gi,
    (_m, prefix) => `${prefix}-\u221e\u5230+\u221e`,
  );

  return out;
}

export function decodeFormulaLikeText(raw: string): string {
  let out = normalizeFormulaPlaceholderGlyphs(String(raw || ""));
  if (!out) return "";
  try {
    out = decodeURIComponent(out);
  } catch {
    // keep raw text
  }

  out = out
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, "\u221a($1)")
    .replace(/\\sqrt\s*\(([^()]+)\)/g, "\u221a($1)")
    .replace(/\\cdot/g, "\u00b7")
    .replace(/\\times/g, "\u00d7")
    .replace(/\\theta/g, "\u03b8")
    .replace(/\\omega/g, "\u03c9")
    .replace(/\\sigma/g, "\u03c3")
    .replace(/\\chi/g, "\u03c7")
    .replace(/\\mu/g, "\u03bc")
    .replace(/\\lambda/g, "\u03bb")
    .replace(/\\phi/g, "\u03c6")
    .replace(/\\psi/g, "\u03c8")
    .replace(/\\pi/g, "\u03c0")
    .replace(/\\tau/g, "\u03c4")
    .replace(/\\infty/g, "\u221e")
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s*([=+\-*/])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  out = normalizeFormulaPlaceholderGlyphs(out)
    .replace(/([\p{Script=Latin}\p{Script=Greek}\u03b8\u03c9\u03c3\u03bc\u03bb\u03c6\u03c8\u03c0\u03c4\u03c7XYZxyz])_\{([^{}]+)\}\^\{([^{}]+)\}/gu, "$1_{$2}^{$3}")
    .replace(/([\p{Script=Latin}\p{Script=Greek}\u03b8\u03c9\u03c3\u03bc\u03bb\u03c6\u03c8\u03c0\u03c4\u03c7XYZxyz])\^\{([^{}]+)\}_\{([^{}]+)\}/gu, "$1_{$3}^{$2}");

  return normalizeMathDisplayText(out);
}
