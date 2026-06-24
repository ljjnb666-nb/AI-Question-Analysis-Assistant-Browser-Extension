import React from "react";

export function renderMathText(text: string): React.ReactNode {
  const lines = String(text || "")
    .split("\n")
    .map((line) => normalizeRenderableMathText(line));
  return (
    <>
      {lines.map((line, lineIndex) => (
        <React.Fragment key={`line-${lineIndex}`}>
          {lineIndex > 0 ? <br /> : null}
          {renderMathTextLine(line, `line-${lineIndex}`)}
        </React.Fragment>
      ))}
    </>
  );
}

export function renderMathTextLine(text: string, keyPrefix: string): React.ReactNode[] {
  return renderStructuredMathTextLine(text, keyPrefix, 0);
}

export function renderStructuredMathTextLine(text: string, keyPrefix: string, depth: number): React.ReactNode[] {
  if (!text) return [];
  if (depth >= 4) return renderMathAtoms(text, keyPrefix);

  const fraction = findNextFractionExpression(text);
  if (!fraction) return renderMathAtoms(text, keyPrefix);

  const out: React.ReactNode[] = [];
  out.push(...renderStructuredMathTextLine(text.slice(0, fraction.start), `${keyPrefix}-pre`, depth + 1));
  out.push(
    <span
      key={`${keyPrefix}-frac-${depth}-${fraction.start}`}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        verticalAlign: "middle",
        margin: "0 0.14em",
        lineHeight: 1.05,
      }}
    >
      <span style={{ padding: "0 0.18em", borderBottom: "1px solid currentColor" }}>
        {renderStructuredMathTextLine(fraction.numerator, `${keyPrefix}-num`, depth + 1)}
      </span>
      <span style={{ padding: "0 0.18em" }}>
        {renderStructuredMathTextLine(fraction.denominator, `${keyPrefix}-den`, depth + 1)}
      </span>
    </span>,
  );
  out.push(...renderStructuredMathTextLine(text.slice(fraction.end), `${keyPrefix}-post`, depth + 1));
  return out;
}

export function renderMathAtoms(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const pattern = /([\p{Script=Latin}\p{Script=Greek}\u0300-\u036f]{1,8})_\{([^{}]+)\}\^\{([^{}]+)\}|([\p{Script=Latin}\p{Script=Greek}\u0300-\u036f]{1,8})_\{([^{}]+)\}|([\p{Script=Latin}\p{Script=Greek}\u0300-\u036f]{1,8})\^\{([^{}]+)\}|(\d+)\^\{([^{}]+)\}|([\p{Script=Latin}\p{Script=Greek}\u0300-\u036f]{1,6})(\d{1,3})(?![\p{Script=Latin}\p{Script=Greek}\p{N}])|\^(\([^)]+\)|[\p{L}\p{N}+\-*/=.θωσμλφψπτχ]{1,24})/gu;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let tokenIndex = 0;

  while ((match = pattern.exec(text)) !== null) {
    const index = match.index ?? 0;
    if (index > cursor) out.push(text.slice(cursor, index));

    if (match[1] && match[2] && match[3]) {
      if (looksLikeMathIdentifier(match[1])) {
        out.push(
          <React.Fragment key={`${keyPrefix}-subsup-${tokenIndex++}`}>
            {match[1]}
            <sub>{match[2]}</sub>
            <sup>{match[3]}</sup>
          </React.Fragment>,
        );
      } else {
        out.push(match[0]);
      }
    } else if (match[4] && match[5]) {
      if (looksLikeMathIdentifier(match[4])) {
        out.push(
          <React.Fragment key={`${keyPrefix}-sub-${tokenIndex++}`}>
            {match[4]}
            <sub>{match[5]}</sub>
          </React.Fragment>,
        );
      } else {
        out.push(match[0]);
      }
    } else if (match[6] && match[7]) {
      if (looksLikeMathIdentifier(match[6])) {
        out.push(
          <React.Fragment key={`${keyPrefix}-sup-${tokenIndex++}`}>
            {match[6]}
            <sup>{match[7]}</sup>
          </React.Fragment>,
        );
      } else {
        out.push(match[0]);
      }
    } else if (match[8] && match[9]) {
      out.push(
        <React.Fragment key={`${keyPrefix}-numsup-${tokenIndex++}`}>
          {match[8]}
          <sup>{match[9]}</sup>
        </React.Fragment>,
      );
    } else if (match[10] && match[11]) {
      if (looksLikeMathIdentifier(match[10])) {
        out.push(
          <React.Fragment key={`${keyPrefix}-sub-${tokenIndex++}`}>
            {match[10]}
            <sub>{match[11]}</sub>
          </React.Fragment>,
        );
      } else {
        out.push(match[0]);
      }
    } else if (match[12]) {
      if (looksLikeMathIdentifier(match[12])) {
        out.push(
          <React.Fragment key={`${keyPrefix}-sub-${tokenIndex++}`}>
            {match[12]}
            <sub>{match[13]}</sub>
          </React.Fragment>,
        );
      } else {
        out.push(match[0]);
      }
    } else if (match[14]) {
      const superscript = match[14].replace(/^\((.*)\)$/u, "$1");
      out.push(<sup key={`${keyPrefix}-sup-${tokenIndex++}`}>{superscript}</sup>);
    }

    cursor = index + match[0].length;
  }

  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

export function normalizeRenderableMathText(text: string): string {
  const raw = String(text || "");
  if (!raw) return "";

  return raw
    .replace(/\b([A-Za-z])\s+(\d+)\s+(\d+)(?=\s*(?:[),+\-*/=]|$))/g, "$1_{$2}^{$3}")
    .replace(/([\p{Script=Greek}])\s+(\d+)(?=\s*(?:[),+\-*/=]|$))/gu, "$1^{$2}")
    .replace(/\b([A-Za-z])\s+(\d+)(?=\s*(?:[),+\-*/=]|$))/g, "$1_{$2}")
    .replace(/([\p{Script=Latin}\p{Script=Greek}])_\{(\d+)\}\s+(\d+)(?=\s*(?:[),+\-*/=]|$))/gu, "$1_{$2}^{$3}")
    .replace(/([\p{Script=Latin}\p{Script=Greek}])_\{(\d+)\}\s+\^\{(\d+)\}/gu, "$1_{$2}^{$3}")
    .replace(/([\p{Script=Latin}\p{Script=Greek}])(\d+)(?=[\p{Script=Han}])/gu, "$1_{$2}")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

export function findNextFractionExpression(text: string): { start: number; end: number; numerator: string; denominator: string } | null {
  const input = String(text || "");
  for (let i = 0; i < input.length; i += 1) {
    if (input[i] !== "(") continue;
    const numeratorEnd = findMatchingParen(input, i);
    if (numeratorEnd < 0) continue;

    let cursor = numeratorEnd + 1;
    while (cursor < input.length && /\s/.test(input[cursor])) cursor += 1;
    if (input[cursor] !== "/") continue;
    cursor += 1;
    while (cursor < input.length && /\s/.test(input[cursor])) cursor += 1;
    if (input[cursor] !== "(") continue;

    const denominatorStart = cursor;
    const denominatorEnd = findMatchingParen(input, denominatorStart);
    if (denominatorEnd < 0) continue;

    return {
      start: i,
      end: denominatorEnd + 1,
      numerator: input.slice(i + 1, numeratorEnd).trim(),
      denominator: input.slice(denominatorStart + 1, denominatorEnd).trim(),
    };
  }
  return null;
}

export function findMatchingParen(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function looksLikeMathIdentifier(token: string): boolean {
  const value = String(token || "").trim();
  if (!value) return false;
  if (/^[\p{Script=Han}]+$/u.test(value)) return false;
  return /[\p{L}θωσμλφψπτχ]/u.test(value);
}
