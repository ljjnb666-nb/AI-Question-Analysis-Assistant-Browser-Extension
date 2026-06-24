import type { ParseResult, QuestionBlock, RouteUsed } from "../types";

export async function mockParse(block: QuestionBlock, route: RouteUsed = "text"): Promise<ParseResult> {
  await new Promise((r) => setTimeout(r, 800 + Math.random() * 500));
  return {
    blockId: block.id,
    questionType: block.questionTypeGuess === "unknown" ? "single_choice" : block.questionTypeGuess,
    answer: "B",
    confidence: 0.91,
    briefExplanation: "根据题意，选项 B 最符合要求。（未设置 API Key，当前为演示结果）",
    detailedExplanation: "请在侧边栏“设置”中选择 AI 提供商并填写 API Key，即可获得真实解析。\n\n当前为 Mock 演示数据。",
    recognizedText: block.previewText || "(请设置 API Key 获取真实 OCR 内容)",
    routeUsed: route,
    ocrQualityScore: 0.85,
    warning: undefined,
  };
}
