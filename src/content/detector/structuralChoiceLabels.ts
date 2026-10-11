/**
 * Recover four standalone visual option labels when CSS layout flattens
 * HTMLElement.innerText and the older newline-only recovery cannot run.
 *
 * A bounded, single-card DOM structure is the sole source of labels and
 * option ownership. Never interpret an enclosing question list, a link
 * directory or arbitrary prose as a complete choice question.
 */
export function recoverStructuralChoiceLabels(container: Element): string | null {
  if (!container.matches("div,article,section,li") || container.closest("nav,header,footer,aside,[role='navigation']")) return null;
  const raw = container.textContent || "";
  if (raw.length < 35 || raw.length > 550 || container.childElementCount > 12
    || container.querySelectorAll("a").length > 2
    || container.querySelectorAll("button,input,textarea,select").length > 2) return null;

  const markers = Array.from(container.querySelectorAll("span,div,p,li,b,strong,em,i,label"))
    .filter((node) => node.childElementCount === 0 && /^[A-D]$/.test((node.textContent || "").trim())
      && !node.closest("a,button,nav,header,footer,aside"));
  if (markers.length !== 4 || markers.map(node => node.textContent!.trim()).join("") !== "ABCD") return null;

  const doc = container.ownerDocument;
  const readBefore = () => {
    const range = doc.createRange();
    range.selectNodeContents(container);
    range.setEndBefore(markers[0]!);
    return range.toString().replace(/\s+/g, " ").trim();
  };
  const stem = readBefore();
  if (stem.length < 18 || stem.length > 450
    || !/[?？]|[（(]\s*[）)]|下列|哪种|哪项|属于|选择|Which|Select/i.test(stem)) return null;

  const options: string[] = [];
  for (let index = 0; index < markers.length; index++) {
    const range = doc.createRange();
    range.selectNodeContents(container);
    range.setStartAfter(markers[index]!);
    if (index < 3) range.setEndBefore(markers[index + 1]!);
    let body = range.toString().replace(/\s+/g, " ").trim();
    if (index === 3) {
      // Koolearn-style item footers follow the final option. Neither footer
      // nor the answer link belongs to the option value.
      body = body.replace(/\s*题型[:：]\s*(?:单选题|多选题|判断题)[\s\S]*$/u, "").trim();
    }
    if (body.length < 2 || body.length > 180 || /[?？]/.test(body)
      || /(?:第\s*\d+\s*题|查看答案|点击查看|试题检索|提交作业)/u.test(body)
      || /^[A-D]$/u.test(body)) return null;
    options.push(`${"ABCD"[index]}. ${body}`);
  }
  return `${stem} ${options.join(" ")}`.trim();
}
