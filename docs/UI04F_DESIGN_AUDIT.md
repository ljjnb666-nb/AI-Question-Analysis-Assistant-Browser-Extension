# UI-04F Design Audit: Candidate Workspace Frontend

**Date**: 2026-10-03  
**Auditor**: Frontend Design Owner (Gemini)  
**Target**: Candidate Workspace (`src/sidepanel/CandidatesTab.tsx`, `CandidateWorkspaceCard.tsx`, `candidateWorkspaceSections.tsx`, `candidateWorkspaceAnswer.tsx`, `candidateWorkspaceContent.tsx`)  
**Commit Baseline**: `092a7628986c110c4dbb4be2d92816f280450451`

---

## 1. Executive Summary

The previous UI-04 implementation established a rock-solid engineering foundation with strict authority boundaries, exact-origin hydration, route fencing, and cross-tab isolation. However, the visual presentation was strictly engineering-led:
- It resembled an internal admin dashboard / database record inspector rather than a commercial-grade, focused AI question-solving workspace.
- It suffered from a severe "button wall" (up to 7 chunky buttons of equal visual weight), rigid multi-column layouts that break at narrow widths (320px), heavy nested borders/slabs for options, disconnected card actions, and cold metric blocks.
- The user cannot easily glance and immediately answer the 8 core user questions: (1) What questions were found? (2) Which ones are selected? (3) Which one is currently processing? (4) Which ones are completed? (5) Which need review? (6) What answer was produced? (7) What can be filled? (8) What do I need to do next?

This redesign completely overhauls the visual and interaction layer while strictly honoring 100% of the frozen runtime, authority, and state contracts.

---

## 2. Detailed Audit of Existing UI-04 Presentation

### 2.1 Summary Metrics (`CandidateSummary`)
- **Current implementation**: 4-column definition list (`<dl>`) stacking label over large number (`已识别 3`, `已选中 1`, `已完成 2`, `待复核 1`).
- **Weaknesses**:
  - Rigid 4-column grid provides only ~65px width per column at 320px viewports, forcing text into awkward multi-line hyphenation and word breaks (`overflowWrap: "anywhere"`).
  - Telemetry/dashboard visual style: when counts are `0 0 0 0`, it feels cold, vacant, and technical.
  - Consumes significant vertical height before any actionable content or questions appear.
- **Redesign Opportunity**: Transform into a sleek, unified metrics bar with subtle pill containers, clear visual hierarchy, semantic `<dl>` `<dt>` `<dd>` tags (preserving all accessibility and test contracts), with high contrast typography and compact horizontal spacing.

### 2.2 Action Hierarchy & "Button Wall" (`CandidateActionBar`)
- **Current implementation**: 2-column grid displaying up to 7 buttons (`当前屏`, `整页扫描`, `解析并填答`, `解析所选`, `填写所选`, `选择待复核题目`, `重试待复核题目`).
- **Weaknesses**:
  - **Button Wall**: 7 heavy rounded rectangular buttons with similar visual prominence create severe cognitive fatigue.
  - **No clear hierarchy**: Primary user action ("解析并填答" Solve & Fill) has almost the same visual footprint as "当前屏" or "选择待复核题目".
  - **Floating 7th button**: In odd-count scenarios (e.g. 7 buttons), the final button either stretches awkwardly or creates visual imbalance.
  - **Awkward 320px layout**: 8-character Chinese labels (e.g. "重试待复核题目", "选择待复核题目") wrap onto 2-3 lines in 140px button widths.
- **Redesign Opportunity**:
  - Establish a crisp, clear 3-tier action architecture:
    1. **Primary Hero Row**: Solve & Fill (`解析并填答` / `停止解析并填答`) as the focal primary CTA, accompanied by a clean, integrated Scan segmented toggle (`当前屏` / `整页扫描`).
    2. **Contextual Batch Actions**: Batch actions (`解析所选` / `填写所选`) styled as refined secondary actions that react dynamically to selection state.
    3. **Review Triage Strip**: Review-specific triage actions (`选择待复核题目` / `重试待复核题目`) housed in a dedicated, restrained warning-accented pill group that only surfaces when `riskyCount > 0`.

### 2.3 Filter Bar & Selection Control (`CandidateReviewToolbar`)
- **Current implementation**: 5 ghost/secondary buttons in a flex-wrap container (`全部`, `已选中`, `待解析`, `已完成`, `待复核`), with `清除选择` placed on a separate second line aligned right.
- **Weaknesses**:
  - Wastes two full rows of vertical space.
  - Looks like a scattered collection of small buttons rather than a cohesive, modern segmented control / tab bar.
  - At 320px, buttons wrap into 3 vertical rows, creating excessive dead space.
- **Redesign Opportunity**:
  - Create a modern, ultra-compact Segmented Filter Bar with unified pill styling, clear active-indicator background, and inline badge counts (e.g. `全部 3 · 待复核 1`).
  - Position `清除选择` inline with subtle ghost styling so it only occupies space when selections exist without creating a whole extra row.

### 2.4 Candidate Card Composition & Hierarchy (`CandidateWorkspaceCard`)
- **Current implementation**:
  - Heavy rectangular surface container with dark background and 1px border.
  - Checkbox + Question Number on left, Status Badge on right.
  - Question stem displayed above options.
  - Each option rendered as a full-width dark pill (`surfaceSubtle`).
  - Review reason rendered as raw unformatted secondary text above the answer.
  - Answer section rendered in a separate dark raised container with "答案 置信度 XX%" and answer value.
  - Action buttons (`填写答案`, `查看解析`, `视觉重试`) placed inside the answer section, while `定位` is orphaned in the card footer below.
- **Weaknesses**:
  - **"Boxes inside boxes" nesting**: Surface card -> option capsules -> answer box -> explanation box -> action row. Excessive visual weight, heavy borders, dark nested rectangles.
  - **Weak answer salience**: The answer (e.g. "B" or "4") is buried in a gray container with technical confidence metrics.
  - **Fragmented actions**: Why is "定位" (Locate) at the very bottom outside the answer box, while "填写答案" is inside? Card actions should be unified, purposeful, and intuitive.
  - **Heavy option list**: 4 to 8 full-width black capsules look like multiple mini-cards inside a card, overwhelming the stem and answer.
  - **Understated review state**: Low-confidence or incomplete-question warnings are rendered as plain gray text strings without clear visual urgency or guidance.
- **Redesign Opportunity**:
  - **Card Surface**: Clean, elegant Orbit card with refined corner radius (`orbitRadius.md`), subtle border, and calm elevation. Selected cards receive a signature left accent bar and soft indigo tint. Active/solving cards receive an ambient AI breathing glow.
  - **Card Header**: Seamless row with a custom accessible native checkbox, crisp Question index badge (`第 1 题`), and a refined status pill (`已完成`, `待复核`, `已识别`, `解析中`).
  - **Options Presentation**: Clean, modern exam-style option items with circular/rounded letter keys (A, B, C, D) and comfortable typographic hierarchy—removing heavy dark pill capsules.
  - **Answer Presentation**: A dedicated, prominent Answer Banner that makes the answer instantly readable at a glance:
    - Bold, clear answer display with LaTeX/formula math support.
    - Subtle, elegant confidence tag (not dominating the answer).
    - Unified card action toolbar: `填写答案` (primary/secondary fill CTA), `查看解析` (disclosure), `视觉重试` (when error/low-confidence), and `定位` (quick locate) grouped logically in one harmonious row.
  - **Review State Treatment**: When a candidate requires review, an integrated amber/warning notice card with a warning icon and explicit, localized reason text (e.g. "答案置信度较低，请先复核再填写。").

### 2.5 Empty States (`CandidateEmptyState`)
- **Current implementation**: A bare, dark surface box with plain unstyled text: `先用“当前屏”或“整页扫描”开始识别。`
- **Weaknesses**: Looks like a placeholder developer mockup.
- **Redesign Opportunity**: A polished, welcoming empty state with a subtle geometric/scan icon illustration, welcoming header, calm explanatory copy, and clear guidance.

### 2.6 Responsive Layout & Narrow Viewports (320px–480px)
- **Current implementation**: Designed with desktop assumptions, then patched with flex-wrap and `overflowWrap: "anywhere"`.
- **Weaknesses**: At 320px, multiple elements wrap unpredictably, causing jarring height changes and visual noise.
- **Redesign Opportunity**: Mobile-first responsive design tailored specifically for 320px–480px side panels:
  - Tightened spacing tokens for narrow panels (`orbitSpacing[2]` vs `orbitSpacing[3]`).
  - Intelligent flex wrapping without breaking button text.
  - Zero horizontal overflow guaranteed across 320px, 360px, 400px, and 480px.

---

## 3. Elements to Preserve (Hard Engineering Contracts)

1. **All Data & Authority Contracts**:
   - `candidates: DetectedCandidate[]`, `filteredCandidates`, `candidateViewFilter`
   - `selectedCount`, `selectedSolvedCount`, `doneCount`, `riskyCount`
   - `isRiskyCandidate`, `isCandidateFillReady`, `deriveCandidatePresentation`
   - `findActiveCandidateId` exact workspace origin and stable question identity binding
   - `isParseResultFillAuthoritative` provider provenance check
2. **All Accessibility & Semantic Markers**:
   - `role="article"` on each candidate card with `aria-label={copy.question(index)}`
   - Native `<input type="checkbox">` with `aria-label={copy.select(index)}`
   - `role="region" aria-label={copy.answer}` for answer section
   - `role="status"` for empty state
   - `role="group"` for actions and filters
   - Visible keyboard focus rings using `orbitFocus.outline`
   - Exact button labels and roles expected by unit tests and E2E specs
3. **Activity Strip & Shell Integration**:
   - Global status in `SidePanelHeader`
   - Workflow progress owned by `SidePanelActivityStrip`
   - Local lifecycle owned by candidate cards

---

## 4. Redesign Architecture Plan

```
+-------------------------------------------------------------+
| SidePanelHeader (Tab Navigation, Status, Provider)          |
+-------------------------------------------------------------+
| Workspace Summary & Metrics (Compact 4-Pill Metric Bar)     |
| [已识别 3]   [已选中 1]   [已完成 2]   [待复核 1]             |
+-------------------------------------------------------------+
| Primary Action Hub                                          |
| [ 解析并填答 (Hero CTA) ]    [当前屏 | 整页扫描 (Scan Group)] |
| [ 解析所选 ]                 [ 填写所选 ]                    |
| [ 选择待复核题目 ]           [ 重试待复核题目 ] (if risky > 0)|
+-------------------------------------------------------------+
| Segmented Filter Bar & Clear Selection                      |
| [全部 (3)] [已选中 (1)] [待解析 (0)] [已完成 (2)] [待复核 (1)]|
|                                            [ 清除选择 ]     |
+-------------------------------------------------------------+
| Candidate Cards Stream (Scrollable)                         |
| +---------------------------------------------------------+ |
| | [x] 第 1 题                          [ 已完成 (Success) ]| |
| | Question Stem (with math & full-disclosure toggle)      | |
| | Media Figures (if present, loaded with fallback)        | |
| | Clean Exam Options:                                     | |
| |   (A) 3                                                 | |
| |   (B) 4                                                 | |
| |   (C) 5                                                 | |
| |   (D) 6                                                 | |
| | Answer Showcase:                                        | |
| |   [ 答案: B ]                   [ 置信度 96% ]           | |
| |   [ 填写答案 ]  [ 查看解析 ]  [ 视觉重试 ]  [ 定位 ]     | |
| +---------------------------------------------------------+ |
| +---------------------------------------------------------+ |
| | [ ] 第 2 题                          [ 待复核 (Warning) ]| |
| | Stem & Options...                                       | |
| | Review Alert Banner:                                    | |
| |   ⚠️ 答案置信度较低，请先复核再填写。                      | |
| | Answer Showcase:                                        | |
| |   [ 答案: B ]                   [ 置信度 61% ]           | |
| |   [ 填写答案 ]  [ 查看解析 ]  [ 视觉重试 ]  [ 定位 ]     | |
| +---------------------------------------------------------+ |
+-------------------------------------------------------------+
| Sticky Activity Strip (when solving/running)                |
+-------------------------------------------------------------+
```

This audit forms the direct specification for the UI-04F implementation.
