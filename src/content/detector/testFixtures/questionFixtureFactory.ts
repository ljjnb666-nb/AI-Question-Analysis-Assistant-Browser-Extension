export type Rect = { left: number; top: number; width: number; height: number };

export type FixtureImage = { src: string; width: number; height: number; alt?: string };

export type QuestionFixtureOptions = {
  id: string;
  ordinal?: number;
  top: number;
  left?: number;
  width?: number;
  height?: number;
  stem: string;
  options?: string[];
  images?: FixtureImage[];
  clippedTop?: boolean;
  clippedBottom?: boolean;
};

export function setElementRect(el: Element, rect: Rect): void {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => rect,
    }),
  });
}

export function setViewport(width = 1600, height = 900): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

export function mockLocation(url = "https://example.com/quiz"): void {
  Object.defineProperty(window, "location", { configurable: true, value: new URL(url) });
}

export function createQuestionFixture(options: QuestionFixtureOptions): HTMLElement {
  const left = options.left ?? 60;
  const width = options.width ?? 760;
  const height = options.height ?? 300;
  const title = options.ordinal ? `<div id="${options.id}-title" class="questionTit">${options.ordinal}. single choice</div>` : "";
  const images = (options.images ?? []).map((image, index) =>
    `<img id="${options.id}-image-${index}" src="${image.src}"${image.alt ? ` alt="${image.alt}"` : ""}>`,
  ).join("");
  const choices = (options.options ?? ["A. one", "B. two", "C. three", "D. four"])
    .map((choice, index) => `<li id="${options.id}-option-${index}">${choice}</li>`)
    .join("");
  document.body.insertAdjacentHTML("beforeend", `
    <div id="${options.id}" class="questionBox">
      ${title}
      <div id="${options.id}-content" class="questionContent">${options.stem}${images}</div>
      <ul id="${options.id}-options">${choices}</ul>
    </div>
  `);
  const root = document.getElementById(options.id)!;
  setElementRect(root, { left, top: options.top, width, height });
  const visibleTop = options.clippedTop ? Math.min(0, options.top) : options.top;
  const visibleBottom = options.clippedBottom ? Math.min(900, options.top + height) : options.top + height;
  setElementRect(document.getElementById(`${options.id}-content`)!, { left: left + 20, top: visibleTop + 44, width: width - 40, height: Math.max(24, visibleBottom - visibleTop - 108) });
  const titleEl = document.getElementById(`${options.id}-title`);
  if (titleEl) setElementRect(titleEl, { left: left + 20, top: visibleTop + 16, width: 220, height: 24 });
  setElementRect(document.getElementById(`${options.id}-options`)!, { left: left + 20, top: visibleBottom - 100, width: 260, height: 92 });
  (options.options ?? ["A. one", "B. two", "C. three", "D. four"]).forEach((_, index) => {
    setElementRect(document.getElementById(`${options.id}-option-${index}`)!, { left: left + 40, top: visibleBottom - 92 + index * 22, width: 160, height: 18 });
  });
  (options.images ?? []).forEach((image, index) => {
    setElementRect(document.getElementById(`${options.id}-image-${index}`)!, { left: left + 40, top: visibleTop + 80 + index * (image.height + 10), width: image.width, height: image.height });
  });
  return root;
}

export function createImageQuestionFixture(options: QuestionFixtureOptions): HTMLElement {
  return createQuestionFixture(options);
}

export function createOptionImageQuestionFixture(id: string, top: number): HTMLElement {
  document.body.insertAdjacentHTML("beforeend", `
    <div id="${id}" class="questionBox">
      <div id="${id}-title" class="questionTit">8. single choice</div>
      <div id="${id}-content" class="questionContent">Which image is correct?</div>
      <ul id="${id}-options">
        ${["a", "b", "c", "d"].map((letter, index) => `<li id="${id}-option-${index}" class="option-item">${letter.toUpperCase()}. <img id="${id}-image-${index}" src="https://example.com/${letter}.png"></li>`).join("")}
      </ul>
    </div>
  `);
  const root = document.getElementById(id)!;
  setElementRect(root, { left: 60, top, width: 760, height: 420 });
  setElementRect(document.getElementById(`${id}-title`)!, { left: 80, top: top + 16, width: 220, height: 24 });
  setElementRect(document.getElementById(`${id}-content`)!, { left: 80, top: top + 52, width: 640, height: 32 });
  setElementRect(document.getElementById(`${id}-options`)!, { left: 80, top: top + 100, width: 400, height: 300 });
  ["a", "b", "c", "d"].forEach((_, index) => {
    setElementRect(document.getElementById(`${id}-option-${index}`)!, { left: 100, top: top + 108 + index * 70, width: 300, height: 64 });
    setElementRect(document.getElementById(`${id}-image-${index}`)!, { left: 140, top: top + 108 + index * 70, width: 120, height: 60 });
  });
  return root;
}
