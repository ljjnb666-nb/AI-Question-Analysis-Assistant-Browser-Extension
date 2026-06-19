import { describe, expect, it } from "vitest";
import { pickBestAutoSolvePreviewText, sanitizeAutoSolvePreviewText } from "./autoSolvePreview";

describe("autoSolvePreview", () => {
  it("prefers complete raw preview over duplicated rich preview for normal single choice questions", () => {
    const rawText = "3.【单选题】 (10分) 开环传递函数G(s)H(s)在[s]右半平面极点的个数为P，当w由0→ +无穷变化时，若开环G(j)H(j)曲线逆时针包围（－1，j0）点P/2圈，则闭环系统( )。 A. 不稳定 B. 稳定 C. 临界稳定 D. 发散";
    const richText = "3.【单选题】 (10分) 开环传递函数G(s)H(s)在 3.【单选题】 (10分)\n开环传递函数G(s)H(s)在\nA. 不稳定 B. 稳定 C. 临界稳定 D. 发散\nA. 不稳定 A. 不稳定\nB. 稳定 B. 稳定\nC. 临界稳定 C. 临界稳定\nD. 发散 D. 发散";

    const preview = pickBestAutoSolvePreviewText(rawText, richText, "single_choice");

    expect(preview).toContain("开环传递函数G(s)H(s)在[s]右半平面极点的个数为P");
    expect(preview).toContain("当w由0→ +无穷变化时");
    expect(preview).toContain("D. 发散");
    expect(preview).not.toContain("3.【单选题】 (10分) 开环传递函数G(s)H(s)在 3.【单选题】");
    expect((preview.match(/A\./g) || []).length).toBe(1);
  });

  it("sanitizes duplicate options from noisy choice previews", () => {
    const noisy = "4.【单选题】 (10分) 开环Nyquist轨迹与负实轴交点的频率。 A. 幅值穿越频率 A. 幅值穿越频率 B. 相位穿越频率 B. 相位穿越频率 C. 截止频率 D. 谐振频率";

    const preview = sanitizeAutoSolvePreviewText(noisy, "single_choice");

    expect(preview).toBe("4.【单选题】 (10分) 开环Nyquist轨迹与负实轴交点的频率。 A. 幅值穿越频率 B. 相位穿越频率 C. 截止频率 D. 谐振频率");
  });
});
