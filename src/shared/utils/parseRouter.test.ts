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
      expect(PROVIDERS.length).toBeGreaterThanOrEqual(10);
      const ids = PROVIDERS.map((p) => p.id);
      expect(ids).toContain("custom");
      expect(ids).toContain("openai");
      expect(ids).toContain("anthropic");
      expect(ids).toContain("minimax");
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

    it("normalizes numbered fill-blank answers at parse stage", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "7.【填空题】 奈氏图终点相角由______决定，n-m=1时终点相角为______。",
        questionTypeGuess: "fill_blank",
      };
      const rawText = JSON.stringify({
        questionType: "fill_blank",
        answer: "1: n-m（开环传递函数极点数与零点数之差）；2. -90°（或-π/2）",
        confidence: 0.93,
        briefExplanation: "按小问作答",
        detailedExplanation: "1. 第一空：n-m（开环传递函数极点数与零点数之差）\n2. 第二空：-90°（或-π/2）",
        recognizedText: block.previewText,
      });

      const result = buildResult(block, "vision", rawText);
      expect(result.answer).toBe("n-m（开环传递函数极点数与零点数之差）；-90°（或-π/2）");
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

    it("does not override a correct choice answer from explanations that enumerate all options", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "9、单选题 A. Z=(X-3.25)/(σ/√5) B. t=(X-3.25)/(S/√5) C. χ²=(n-1)S²/σ² D. F=S1²/S2²",
        questionTypeGuess: "single_choice",
      };
      const rawText = JSON.stringify({
        questionType: "single_choice",
        answer: "B",
        confidence: 0.97,
        briefExplanation: "由于总体方差未知，应使用t检验，故选B。",
        detailedExplanation: "选项A是Z检验，要求总体方差已知。选项B是t检验，适用于总体方差未知。选项C用于方差检验。选项D用于比较两个方差。所以选B。",
        recognizedText: block.previewText,
      });
      const result = buildResult(block, "vision", rawText);
      expect(result.answer).toBe("B");
    });

    it("corrects single-choice answer from option judgements under negative stem", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "4、单选题 阅读课本“实现共产主义是历史发展的必然”回答问题，下面关于其实现的表述错误的是（）。A. 现实的社会主义事业每前进一步，也就是向着共产主义迈进一步 B. 实现共产主义是广大人民群众的共同愿望 C. 无产阶级的解放与全人类的解放是完全一致的 D. 社会发展的规律是独立于人的社会活动的",
        questionTypeGuess: "single_choice",
      };
      const rawText = JSON.stringify({
        questionType: "single_choice",
        answer: "B",
        confidence: 0.95,
        briefExplanation: "分析各选项：A项正确，B项正确，C项正确，D项错误。",
        detailedExplanation: "A项正确，现实社会主义事业每前进一步就是向共产主义迈进；B项正确；C项正确；D项错误，社会发展规律具有客观性，但并不是独立于人的社会活动之外。",
        recognizedText: block.previewText,
      });
      const result = buildResult(block, "vision", rawText);
      expect(result.answer).toBe("D");
    });

    it("corrects single-choice answer when verdict appears after a long option description", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "1、单选题 阅读课本“共产主义社会的基本特征”内容，回答问题。下面关于共产主义社会说法错误的是（ ） A. 实现人的自由而全面的发展，是共产主义社会的根本特征 B. 在资本主义条件下，人虽然摆脱了对人的依赖关系，但是陷入到了物的依赖性之中 C. 自由时间的大大延长为人的自由而全面的发展提供了广阔前景 D. 共产主义社会将取消分工",
        questionTypeGuess: "single_choice",
      };
      const rawText = JSON.stringify({
        questionType: "single_choice",
        answer: "A",
        confidence: 0.92,
        briefExplanation: "逐项分析。",
        detailedExplanation: "逐项分析：A项实现人的自由而全面的发展是共产主义社会的根本特征是正确的；B项在资本主义条件下陷入物的依赖性符合马克思关于社会形态的论述；C项自由时间的大大延长为人的自由而全面的发展提供了广阔前景也是正确的；D项共产主义社会将取消分工表述错误，共产主义社会消除的是旧式分工。",
        recognizedText: block.previewText,
      });
      const result = buildResult(block, "vision", rawText);
      expect(result.answer).toBe("D");
    });

    it("refuses to trust bare raw choice letters when no structured evidence exists", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "3、单选题 关于共产主义社会的表述正确的是（ ） A. ... B. ... C. ... D. ...",
        questionTypeGuess: "single_choice",
      };
      const rawText = JSON.stringify({
        questionType: "single_choice",
        answer: "A",
        confidence: 0.91,
        briefExplanation: "暂无法确认。",
        detailedExplanation: "题干不完整，无法稳定判断。",
        recognizedText: block.previewText,
      });
      const result = buildResult(block, "vision", rawText);
      expect(result.answer).toBe("需人工确认");
      expect(result.warning).toContain("结构化选项结论");
    });

    it("corrects multi-choice answer from summarized final option set in explanation", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "11、多选题 阅读课本有关共产主义社会的基本特征内容，在共产主义社会中（ ） A. 将实现社会关系的高度和谐 B. 人类文明与自然之间的高度和谐 C. 人的自由而全面的发展 D. 三大差别将会消亡",
        questionTypeGuess: "multi_choice",
      };
      const rawText = JSON.stringify({
        questionType: "multi_choice",
        answer: "B,C",
        confidence: 0.98,
        briefExplanation: "根据课本内容判断。",
        detailedExplanation: "根据课本关于共产主义社会基本特征的内容：（1）社会生产力高度发展，产品极大丰富；（2）社会关系高度和谐；（3）人类文明与自然之间的高度和谐；（4）人的自由而全面的发展；（5）三大差别将会消亡。因此A、B、C、D四项均为共产主义社会的基本特征，均应选入。",
        recognizedText: block.previewText,
      });
      const result = buildResult(block, "vision", rawText);
      expect(result.answer).toBe("A,B,C,D");
    });

    it("corrects multi-choice answer from long per-option verdicts using A dot syntax", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "13、多选题 阅读课本“实现共产主义是历史发展的必然”思考问题。以下理解正确的是（ ）。 A. 共产主义是可以实现的理想 B. 实现共产主义社会离不开工人阶级及其政党能动性的发挥 C. 实现共产主义理想与人民对美好生活和理想社会的向往是一致的 D. 无产阶级和工人阶级是同一个阶级的两种不同的称呼",
        questionTypeGuess: "multi_choice",
      };
      const rawText = JSON.stringify({
        questionType: "multi_choice",
        answer: "A,B,C",
        confidence: 0.9,
        briefExplanation: "逐项分析。",
        detailedExplanation: "逐项分析：A. 共产主义是可以实现的理想——正确；B. 实现共产主义社会离不开工人阶级及其政党能动性的发挥——正确；C. 实现共产主义理想与人民对美好生活和理想社会的向往是一致的——正确；D. 无产阶级和工人阶级是同一个阶级的两种不同的称呼——正确。",
        recognizedText: block.previewText,
      });
      const result = buildResult(block, "vision", rawText);
      expect(result.answer).toBe("A,B,C,D");
    });

    it("corrects mixed multi-choice verdicts using A dot syntax", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "15、多选题 阅读课本“实现共产主义是长期的历史过程”内容问题。下面说法正确的是（ ）。 A. 实现共产主义必须经历许多历史阶段 B. 社会主义社会在各方面完全消除了旧社会的痕迹 C. 不具备主观客观条件下的革命，不可能成功并建立起共产主义新社会 D. 特别是2008年以来，资本主义世界又出现严重的金融危机和社会危机",
        questionTypeGuess: "multi_choice",
      };
      const rawText = JSON.stringify({
        questionType: "multi_choice",
        answer: "A,B,C",
        confidence: 0.9,
        briefExplanation: "逐项分析。",
        detailedExplanation: "逐项分析：A. 实现共产主义必须经历许多历史阶段——正确；B. 社会主义社会在各方面完全消除了旧社会的痕迹——错误；C. 不具备主观客观条件下的革命，不可能成功并建立起共产主义新社会——正确；D. 特别是2008年以来，资本主义世界又出现严重的金融危机和社会危机——正确。",
        recognizedText: block.previewText,
      });
      const result = buildResult(block, "vision", rawText);
      expect(result.answer).toBe("A,C,D");
    });

    it("prefers structured optionSelections over free-form multi-choice answer text", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "11、多选题 阅读课本有关共产主义社会的基本特征内容，在共产主义社会中（ ） A. 将实现社会关系的高度和谐 B. 人类文明与自然之间的高度和谐 C. 人的自由而全面的发展 D. 三大差别将会消亡",
        questionTypeGuess: "multi_choice",
      };
      const rawText = JSON.stringify({
        questionType: "multi_choice",
        answer: "B,C",
        optionSelections: { A: true, B: true, C: true, D: true },
        confidence: 0.98,
        briefExplanation: "根据课本内容判断。",
        detailedExplanation: "略",
        recognizedText: block.previewText,
      });
      const result = buildResult(block, "vision", rawText);
      expect(result.answer).toBe("A,B,C,D");
      expect(result.optionSelections).toEqual({ A: true, B: true, C: true, D: true });
    });

    it("does not misclassify formula-heavy multiple-choice questions as non-choice", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "6、单选题 设X1,X2,X3,X4来自均值为θ的指数分布，其中θ未知，估计量T1=(1/6)*(X1+X2)+(1/3)*(X3+X4)，T2=(1/5)*(X1+2*X2+3*X3+4*X4)，T3=(1/4)*(X1+X2+X3+X4)，在无偏估计中更有效的是（ ）。 A. T1 B. T2 C. T3 D. 无法比较",
        questionTypeGuess: "single_choice",
      };
      const rawText = JSON.stringify({
        questionType: "short_answer",
        answer: "T3",
        confidence: 0.95,
        briefExplanation: "T2不是无偏估计，比较T1和T3的方差，T3更有效。",
        detailedExplanation: "T2的期望为2θ，不是θ的无偏估计；比较T1和T3的方差，Var(T3)=θ²/4 小于 Var(T1)=5θ²/18，故T3更有效，对应选项C。",
        recognizedText: block.previewText,
      });
      const result = buildResult(block, "vision", rawText);
      expect(result.questionType).toBe("single_choice");
      expect(result.answer).toBe("C");
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
      expect(result.answer).toBe("需人工确认");
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
      expect(result.answer).toBe("需人工确认");
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
      expect(result.answer).toBe("需人工确认");
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
      expect(result.answer).toBe("需人工确认");
    });

    it("normalizes placeholder-style non-choice answers to manual confirmation", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "填空题：第一空____ 第二空____",
        questionTypeGuess: "fill_blank",
      };
      const rawText = JSON.stringify({
        questionType: "fill_blank",
        answer: "按分点作答，详见解析",
        confidence: 0.95,
        briefExplanation: "模型未给出逐空答案",
        detailedExplanation: "第一空对应概念，第二空对应结论。",
        recognizedText: block.previewText,
      });
      const result = buildResult(block, "vision", rawText);
      expect(result.answer).toBe("需人工确认");
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

    it("removes next-question tail from recognized single-choice option D", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "5. [单选题] 某系统的校正装置的数学模型为（ ）。A. 超前校正 B. 滞后校正 C. 微分校正 D. PID校正",
        questionTypeGuess: "single_choice",
      };
      const rawText = JSON.stringify({
        questionType: "single_choice",
        answer: "D",
        confidence: 0.92,
        briefExplanation: "根据模型项判断",
        detailedExplanation: "略",
        recognizedText: "5. [单选题] 某系统的校正装置的数学模型为（ ）。A. 超前校正 B. 滞后校正 C. 微分校正 D. PID校正 5. [",
      });

      const result = buildResult(block, "vision", rawText);
      expect(result.recognizedText).toContain("D. PID校正");
      expect(result.recognizedText).not.toContain("PID校正 5. [");
    });

    it("deduplicates repeated judge recognized text while keeping structured options", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "8. [判断题] 前馈补偿可以在不影响稳定性前提下消除误差。 对 错",
        questionTypeGuess: "judge",
      };
      const rawText = JSON.stringify({
        questionType: "judge",
        answer: "对",
        confidence: 0.9,
        briefExplanation: "前馈补偿可改善误差",
        detailedExplanation: "略",
        recognizedText:
          "8. [判断题] 前馈补偿可以在不影响稳定性前提下消除误差。 对 错 8. [判断题] 前馈补偿可以在不影响稳定性前提下消除误差。 对 错",
      });

      const result = buildResult(block, "vision", rawText);
      const stem = "前馈补偿可以在不影响稳定性前提下消除误差。";
      expect((result.recognizedText.match(new RegExp(stem, "g")) || []).length).toBe(1);
      expect(result.recognizedText).toContain("对");
      expect(result.recognizedText).toContain("错");
    });

    it("repairs missing infinity symbols in frequency-domain recognized text", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "若开环传递函数G(s)H(s)在[s]右半平面有P个极点，当ω由-∞到+∞时，若G(jw)H(jw)曲线逆时针包围(-1,j0)点P圈，则闭环系统( )。",
        questionTypeGuess: "single_choice",
      };
      const rawText = JSON.stringify({
        questionType: "single_choice",
        answer: "D",
        confidence: 0.91,
        briefExplanation: "根据奈奎斯特判据",
        detailedExplanation: "略",
        recognizedText: "若开环传递函数G(s)H(s)在[s]右半平面有P个极点，当ω由 - 到 + 时，若G(jw)H(jw)曲线逆时针包围(-1,j0)点P圈，则闭环系统( )。",
      });

      const result = buildResult(block, "vision", rawText);
      expect(result.recognizedText).toContain("ω由-∞到+∞");
    });

    it("repairs infinity symbols even when omega is missing from the broken span", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "当由-∞到+∞时，若G(jw)H(jw)曲线逆时针包围(-1,j0)点P圈，则闭环系统( )。",
        questionTypeGuess: "single_choice",
      };
      const rawText = JSON.stringify({
        questionType: "single_choice",
        answer: "D",
        confidence: 0.9,
        briefExplanation: "略",
        detailedExplanation: "略",
        recognizedText: "当由-到+时，若G(jw)H(jw)曲线逆时针包围(-1,j0)点P圈，则闭环系统( )。",
      });

      const result = buildResult(block, "vision", rawText);
      expect(result.recognizedText).toContain("由-∞到+∞");
    });

    it("overrides conflicting single-choice answer when explanation clearly points to another option", () => {
      const block: QuestionBlock = {
        ...mockBlock,
        previewText: "5、单选题（2分）设X1,X2,X3,X4来自均值为θ的指数分布,其中θ未知,估计量T=(1/6)(X1+X2)+(1/3)(X3+X4),则D(T)=（ ）. A. (5/18)θ2 B. (1/4)θ2 C. (1/2)θ2 D. (3/8)θ2",
        questionTypeGuess: "single_choice",
      };
      const rawText = JSON.stringify({
        questionType: "single_choice",
        answer: "D",
        confidence: 0.99,
        briefExplanation: "根据方差计算，正确答案应为A。",
        detailedExplanation: "设Xi独立且均值为θ的指数分布，则D(Xi)=θ2。D(T)=(1/36)2θ2+(1/9)2θ2=(5/18)θ2。因此选A。",
        recognizedText: block.previewText,
      });

      const result = buildResult(block, "text", rawText);
      expect(result.answer).toBe("A");
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

  describe("MiniMax provider", () => {
    it("uses OpenAI-compatible chat endpoint with reasoning split enabled", async () => {
      const block: QuestionBlock = {
        id: "minimax-test",
        bbox: { x: 0, y: 0, width: 100, height: 50 },
        previewText: "1+1等于多少？A.1 B.2 C.3 D.4",
        hasImage: true,
        imageDataUrl: "data:image/png;base64,abc",
        questionTypeGuess: "single_choice",
        confidence: 1,
        source: "manual_capture",
      };

      const settings: AppSettings = {
        providerId: "minimax",
        apiKey: "test-key",
        apiModel: "MiniMax-M3",
        preferredRoute: "vision",
        language: "zh",
        enableAnalytics: true,
      };

      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({
          choices: [
            {
              message: {
                content: "{\"questionType\":\"single_choice\",\"answer\":\"B\",\"confidence\":0.98,\"briefExplanation\":\"1+1=2\",\"detailedExplanation\":\"1+1 的结果是 2。\",\"recognizedText\":\"1+1等于多少？A.1 B.2 C.3 D.4\"}",
              },
            },
          ],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await parseQuestion(block, settings);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;

      expect(url).toBe("https://api.minimaxi.com/v1/chat/completions");
      expect(body.model).toBe("MiniMax-M3");
      expect(body.thinking).toEqual({ type: "adaptive" });
      expect(body.reasoning_split).toBe(true);
      expect(body.max_completion_tokens).toBe(1024);
      expect(body.max_tokens).toBeUndefined();
      expect(result.answer).toBe("B");
    });

    it("normalizes custom base url when user includes /v1", async () => {
      const block: QuestionBlock = {
        id: "minimax-custom-url-test",
        bbox: { x: 0, y: 0, width: 100, height: 50 },
        previewText: "1+1等于多少？A.1 B.2 C.3 D.4",
        hasImage: false,
        questionTypeGuess: "single_choice",
        confidence: 1,
        source: "manual_capture",
      };

      const settings: AppSettings = {
        providerId: "minimax",
        apiKey: "test-key",
        apiModel: "MiniMax-M3",
        preferredRoute: "text",
        language: "zh",
        enableAnalytics: true,
        customBaseUrl: "https://api.minimaxi.com/v1",
      };

      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({
          choices: [{ message: { content: "{\"questionType\":\"single_choice\",\"answer\":\"B\",\"confidence\":0.98,\"briefExplanation\":\"1+1=2\",\"detailedExplanation\":\"1+1 的结果是 2。\",\"recognizedText\":\"1+1等于多少？A.1 B.2 C.3 D.4\"}" } }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await parseQuestion(block, settings);
      const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.minimaxi.com/v1/chat/completions");
    });
  });
});
