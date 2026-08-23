import { describe, expect, it } from "vitest";
import { resolveMediaOwnership } from "./mediaOwnership";

describe("media ownership", () => {
  it("uses option ancestry before geometry and fails closed for another question owner", () => {
    document.body.innerHTML = `<div class="questionBox" id="q1"><div class="questionContent"><img id="stem" src="/stem.png"></div><li class="option-item">B. <img id="option" src="/b.png"></li></div><div class="questionBox" id="q2"><img id="next" src="/next.png"></div>`;
    const owner = document.getElementById("q1")!;
    expect(resolveMediaOwnership(document.getElementById("stem")!, owner).role).toBe("stem");
    expect(resolveMediaOwnership(document.getElementById("option")!, owner)).toMatchObject({ role: "option", optionKey: "B" });
    expect(resolveMediaOwnership(document.getElementById("next")!, owner)).toMatchObject({ role: "unknown", reasons: ["CROSS_QUESTION_OWNER"] });
  });
});
