/**
 * Normalize a narrow, observed quiz layout:
 *   question stem
 *   A
 *   option body
 *   B
 *   option body ... C ... D ...
 *
 * Never infer a choice from a single bare letter or a line of unrelated prose.
 * In particular, this transform must not cross multiple question cards: only
 * one ordered A/B/C/D quartet with four nonempty option bodies is accepted.
 * Browsers expose the original block/line structure through HTMLElement.innerText
 * before whitespace normalization discards it.
 */
const DETACHED_MARKER = /(^|\r?\n)([ \t]*)([A-D])(?=[ \t]+\S|[ \t]*\r?\n)/g;

export function recoverDetachedChoiceLabels(raw: string): string {
  if (!raw || raw.length > 1800 || !/[\r\n]/.test(raw)) return raw;
  const matches = [...raw.matchAll(DETACHED_MARKER)];
  if (matches.length !== 4 || matches.map((m) => m[3]).join("") !== "ABCD") return raw;

  const stem = raw.slice(0, matches[0].index ?? 0).trim();
  if (stem.length < 18 || stem.length > 450
    || !/[?？]|[（(]\s*[）)]|下列|哪种|哪项|属于|单选|多选|选择|Which|Select/i.test(stem)) {
    return raw;
  }

  for (let index = 0; index < matches.length; index++) {
    const start = (matches[index].index ?? 0) + matches[index][0].length;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? raw.length) : raw.length;
    const option = raw.slice(start, end).trim();
    if (option.length < 2 || option.length > 180
      || /^([A-D]|查看答案|点击查看|试题检索|提交作业)$/u.test(option)) return raw;
  }

  return raw.replace(DETACHED_MARKER, (_full, prefix: string, indent: string, letter: string) =>
    `${prefix}${indent}${letter}.`);
}
