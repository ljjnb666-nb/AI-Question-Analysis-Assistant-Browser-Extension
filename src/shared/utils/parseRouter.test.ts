import { describe, it, expect, vi, afterEach } from "vitest";
import { getProvider, buildResult, decideRoute, parseQuestion, PROVIDERS } from "./parseRouter";
import type { QuestionBlock, AppSettings } from "../types";

describe("parseRouter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getProvider", () => {
    it("returns provider by id", () => {
      const provider = getProvider("anthropic");
      expect(provider.id).toBe("anthropic");
      expect(provider.supportsVision).toBe(true);
    });

    it("falls back for unknown provider", () => {
      const provider = getProvider("unknown-provider");
      expect(provider.id).toBe("anthropic");
    });

    it("contains expected providers", () => {
      expect(PROVIDERS.length).toBeGreaterThanOrEqual(9);
      const ids = PROVIDERS.map((p) => p.id);
      expect(ids).toContain("custom");
      expect(ids).toContain("openai");
      expect(ids).toContain("anthropic");
    });
  });

  describe("buildResult", () => {
    const mockBlock: QuestionBlock = {
      id: "test-1",
      bbox: { x: 0, y: 0, width: 100, height: 50 },
      previewText: "1+1=?",
      hasImage: false,
      questionTypeGuess: "single_choice",
      confidence: 0.8,
      source: "manual_capture",
    };

    it("parses valid JSON", () => {
      const rawText = JSON.stringify({
        questionType: "single_choice",
        answer: "B",
        confidence: 0.95,
        briefExplanation: "brief",
        detailedExplanation: "detail",
        recognizedText: "text",
      });
      const result = buildResult(mockBlock, "text", rawText);
      expect(result.answer).toBe("B");
      expect(result.confidence).toBe(0.95);
    });

    it("extracts JSON from mixed text", () => {
      const rawText = "prefix {\"answer\":\"D\",\"confidence\":0.85} suffix";
      const result = buildResult(mockBlock, "hybrid", rawText);
      expect(result.answer).toBe("D");
      expect(result.confidence).toBe(0.85);
    });

    it("avoids single-letter choice answer for multi-part fill-blank", () => {
      const fillBlankBlock: QuestionBlock = {
        ...mockBlock,
        previewText:
          "下图甲是生物体内四种有机物的组成与功能关系图，请据图回答：(1)小麦种子细胞中，物质A是 ，物质E是____。(2)相同质量的E和F彻底氧化分解，耗氧量较多的是。",
        questionTypeGuess: "fill_blank",
      };

      const rawText = JSON.stringify({
        questionType: "fill_blank",
        answer: "D",
        confidence: 0.88,
        briefExplanation: "multi-part",
        detailedExplanation:
          "1. (1) 葡萄糖；淀粉\n2. (2) F\n3. (3) C、H、O、N；a+b\n4. (4) ①淀粉 ②砖红色沉淀深浅",
        recognizedText: fillBlankBlock.previewText,
      });

      const result = buildResult(fillBlankBlock, "vision", rawText);
      expect(result.questionType).toBe("fill_blank");
      expect(result.answer).not.toMatch(/^[A-D]$/);
      expect(result.answer.length).toBeGreaterThan(1);
    });

    it("keeps structured multi-part lines in detailed explanation", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "(1)A是什么？(2)B是什么？",
        questionTypeGuess: "short_answer",
      };
      const rawText = JSON.stringify({
        questionType: "short_answer",
        answer: "见分点",
        confidence: 0.8,
        briefExplanation: "按小问回答",
        detailedExplanation: "（1）第一问答案\n（2）第二问答案",
        recognizedText: block.previewText,
      });
      const result = buildResult(block, "vision", rawText);
      expect(result.detailedExplanation).toContain("1.");
      expect(result.detailedExplanation).toContain("2.");
    });

    it("forces non-choice fallback when unknown type returns A,B,C,D but preview is multi-part", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "请据图回答：(1) 第一问 ____ (2) 第二问 ____",
        questionTypeGuess: "unknown",
      };
      const rawText = JSON.stringify({
        questionType: "unknown",
        answer: "A,B,C,D",
        confidence: 0.9,
        briefExplanation: "模型误将其识别为选项集合",
        detailedExplanation: "图中涉及四类有机物与功能关系，请按小问作答。",
        recognizedText: "图中显示四类有机物",
      });
      const result = buildResult(block, "vision", rawText);
      expect(result.answer).not.toBe("A,B,C,D");
      expect(result.answer).toBe("见分点答案");
    });

    it("forces fallback when model marks multi_choice but stem is clearly multi-part fill-blank", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "请据图回答：(1) 第一空____ (2) 第二空____ (3) 第三空____",
        questionTypeGuess: "unknown",
      };
      const rawText = JSON.stringify({
        questionType: "multi_choice",
        answer: "A,B,C,D",
        confidence: 0.82,
        briefExplanation: "题干信息不完整，无法准确作答",
        detailedExplanation: "请补充完整题干后再判断。",
        recognizedText: block.previewText,
      });
      const result = buildResult(block, "vision", rawText);
      expect(result.questionType).toBe("fill_blank");
      expect(result.answer).toBe("见分点答案");
    });

    it("does not treat extracted answer-like line containing only A,B,C,D as valid non-choice answer", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "请据图回答：(1) 第一问____ (2) 第二问____",
        questionTypeGuess: "fill_blank",
      };
      const rawText = JSON.stringify({
        questionType: "fill_blank",
        answer: "A,B,C,D",
        confidence: 0.8,
        briefExplanation: "答案：A,B,C,D",
        detailedExplanation: "当前无法判断，答案：A,B,C,D",
        recognizedText: block.previewText,
      });
      const result = buildResult(block, "vision", rawText);
      expect(result.answer).toBe("见分点答案");
    });

    it("falls back from uncertain long non-choice narrative to structured placeholder", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "请据图回答：(1) 第一问____ (2) 第二问____ (3) 第三问____",
        questionTypeGuess: "fill_blank",
      };
      const rawText = JSON.stringify({
        questionType: "fill_blank",
        answer: "虽然图像显示了一个关系图，但题干部分不完整，无法准确判断所有空。建议提供更完整题图。",
        confidence: 0.7,
        briefExplanation: "题干不完整",
        detailedExplanation: "当前无法确定全部小问答案。",
        recognizedText: block.previewText,
      });
      const result = buildResult(block, "vision", rawText);
      expect(result.answer).toBe("见分点答案");
    });

    it("applies biology heuristic corrections for common fill-blank mistakes", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText:
          "若a个C物质组成b条链，组成某种物质G，该物质G至少含有氧原子的个数是____。为验证磷酸化酶是否为蛋白质，加入双缩脲试剂。",
        questionTypeGuess: "fill_blank",
      };
      const rawText = JSON.stringify({
        questionType: "fill_blank",
        answer: "见分点",
        confidence: 0.9,
        briefExplanation: "按小问作答",
        detailedExplanation:
          "（3）氧原子最少为a+b-1\n（4）对照组加入清水，若出现紫色则说明是蛋白质",
        recognizedText: block.previewText,
      });
      const result = buildResult(block, "vision", rawText);
      expect(result.detailedExplanation).toContain("a+b");
      expect(result.detailedExplanation).not.toContain("a+b-1");
      expect(result.detailedExplanation).toContain("等量已知蛋白质液");
      expect(result.detailedExplanation).not.toContain("清水");
    });

    it("fixes A/E swap in wheat-seed organics mapping question", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText:
          "下图甲是生物体内四种有机物的组成与功能关系图，请据图回答：(1)小麦种子细胞中，物质A是 ，物质E是____。",
        questionTypeGuess: "fill_blank",
      };
      const rawText = JSON.stringify({
        questionType: "fill_blank",
        answer: "见分点",
        confidence: 0.9,
        briefExplanation: "按小问作答",
        detailedExplanation: "（1）小麦种子细胞中，物质A是淀粉，物质E是葡萄糖",
        recognizedText: block.previewText,
      });
      const result = buildResult(block, "vision", rawText);
      expect(result.detailedExplanation).toContain("物质A是葡萄糖，物质E是淀粉");
      expect(result.detailedExplanation).not.toContain("物质A是淀粉");
    });
  });

  describe("decideRoute", () => {
    const mockBlock: QuestionBlock = {
      id: "test-1",
      bbox: { x: 0, y: 0, width: 100, height: 50 },
      previewText: "1+1=?",
      hasImage: false,
      questionTypeGuess: "single_choice",
      confidence: 0.8,
      source: "manual_capture",
    };

    const mockSettings: AppSettings = {
      providerId: "anthropic",
      apiKey: "test-key",
      apiModel: "claude-opus-4-5",
      preferredRoute: "auto",
      language: "zh",
      enableAnalytics: true,
    };

    it("respects preferred route", async () => {
      const route = await decideRoute(mockBlock, { ...mockSettings, preferredRoute: "vision" });
      expect(route).toBe("vision");
    });

    it("returns text for non-vision providers", async () => {
      const route = await decideRoute(mockBlock, { ...mockSettings, providerId: "deepseek" });
      expect(route).toBe("text");
    });

    it("returns hybrid when image flag exists but preview text is still short", async () => {
      const route = await decideRoute({
        ...mockBlock,
        hasImage: true,
        previewText:
          "下图甲是生物体内四种有机物的组成与功能关系图，请据图回答：(1)小麦种子细胞中，物质A是 ，物质E是____。(2)相同质量的E和F彻底氧化分解，耗氧量较多的是。",
      }, mockSettings);
      expect(route).toBe("hybrid");
    });

    it("returns text when image flag exists and preview text is sufficiently complete", async () => {
      const route = await decideRoute({
        ...mockBlock,
        hasImage: true,
        previewText:
          "下图甲是生物体内四种有机物的组成与功能关系图，请据图回答：(1)小麦种子细胞中，物质A是 ，物质E是_______________________。(2)相同质量的E和F彻底氧化分解，耗氧量较多的是 。(3)组成物质C的共同化学元素是 。若a个C物质组成b条链，组成某种物质G，该物质G至少含有氧原子的个数是_______。(4)图乙表示小麦开花数天后测定的种子中主要物质的变化图。请据图回答问题：①小麦成熟种子中主要的有机营养物质是 。检测还原糖时，可溶性还原糖的多少可通过 来判断。",
      }, mockSettings);
      expect(route).toBe("text");
    });

    it("returns vision when captured image payload exists", async () => {
      const route = await decideRoute(
        { ...mockBlock, hasImage: true, imageDataUrl: "data:image/png;base64,abc" },
        mockSettings,
      );
      expect(route).toBe("vision");
    });
  });

  describe("regression: tiku 0.61 multi-part fill-blank", () => {
    it("keeps non-choice structured answer even when model returns single letter", async () => {
      const block: QuestionBlock = {
        id: "tiku-061",
        bbox: { x: 0, y: 0, width: 800, height: 500 },
        previewText:
          "下图甲是生物体内四种有机物的组成与功能关系图，请据图回答：(1)小麦种子细胞中，物质A是 ，物质E是______。(2)相同质量的E和F彻底氧化分解，耗氧量较多的是 。(3)组成物质C的共同化学元素是 。(4)请据图回答问题。",
        hasImage: true,
        imageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        questionTypeGuess: "fill_blank",
        confidence: 0.9,
        source: "manual_capture",
      };

      const settings: AppSettings = {
        providerId: "custom",
        apiKey: "test-key",
        apiModel: "claude-haiku-4-5-20251001",
        preferredRoute: "vision",
        language: "zh",
        enableAnalytics: true,
        customBaseUrl: "http://127.0.0.1:3000",
        customProviderProtocol: "openai",
      };

      const mockedPayload = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                questionType: "fill_blank",
                answer: "D",
                confidence: 0.93,
                briefExplanation: "按小问作答",
                detailedExplanation:
                  "（1）葡萄糖；淀粉\n（2）F\n（3）C、H、O、N；a+b\n（4）①淀粉；砖红色沉淀的深浅 ②磷酸化酶溶液；2 mL等量已知蛋白质液（豆浆、蛋清等）；紫色",
                recognizedText: block.previewText,
              }),
            },
          },
        ],
      };

      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify(mockedPayload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await parseQuestion(block, settings);
      expect(result.questionType).toBe("fill_blank");
      expect(result.answer).not.toMatch(/^[A-D]$/);
      expect(result.answer).not.toBe("D");

      const joined = `${result.answer}\n${result.detailedExplanation}`;
      const keywords = ["葡萄糖", "淀粉", "F", "C、H、O、N", "a+b", "砖红色沉淀", "紫色"];
      const hitCount = keywords.filter((k) => joined.includes(k)).length;
      expect(hitCount).toBeGreaterThanOrEqual(5);
    });
  });
});
