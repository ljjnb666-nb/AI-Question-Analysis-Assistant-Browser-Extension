# domDetector.ts 拆分重构计划

**当前状态**：1140 行，超出 800 行建议上限

**目标**：拆分为职责明确的子模块，每个文件 < 400 行

---

## 分析：当前文件职责

通过代码分析，`domDetector.ts` 包含以下职责：

1. **主检测流程** (detectCandidatesInViewport)
2. **变更监听** (watchForPageChanges, MutationObserver)
3. **元素收集** (collectCandidateElements)
4. **评分系统** (scoreElement, 各种启发式规则)
5. **特定平台支持** (Pintia 系列函数)
6. **容器识别** (getStableQuestionCardContainers, detectStructuredQuestionContainers)
7. **辅助函数** (几何计算、可见性判断、归一化)

---

## 拆分方案

### 新建文件 1: `domDetectorPlatforms.ts` (~250 行)
**职责**：平台特定检测逻辑

迁移函数：
- `isPintiaQuestionListPage()`
- `isPintiaCodeProblemStatementPage()`
- `buildPintiaQuestionListCandidates()`
- `buildPintiaCodeProblemCandidates()`
- `extractPintiaCodeSampleText()`
- `normalizePintiaCodeLine()`
- `pickBestPintiaTitleNode()`
- `pickBestPintiaMetaNode()`
- `isLikelyPintiaQuestionListItem()`
- `scorePintiaCodeProblemCandidate()`
- `isTopClippedQuestionTail()`

**导出接口**：
```typescript
export interface PlatformDetectionResult {
  pintiaListBlocks: QuestionBlock[];
  pintiaCodeBlocks: QuestionBlock[];
}

export function detectPlatformSpecificBlocks(
  hostRightCutX: number,
  vw: number,
  vh: number
): PlatformDetectionResult;
```

---

### 新建文件 2: `domDetectorScoring.ts` (~200 行)
**职责**：候选元素评分系统

迁移函数：
- `scoreElement()`
- `countBlankControls()`
- `countJudgeControls()`
- `hasChoiceSignals()`
- `hasMathSignals()`

**导出接口**：
```typescript
export interface ElementScore {
  confidence: number;
  type: QuestionType;
  signals: {
    blank: number;
    choice: number;
    judge: number;
    math: number;
  };
}

export function scoreElement(el: Element, text: string): ElementScore;
```

---

### 新建文件 3: `domDetectorContainers.ts` (~180 行)
**职责**：结构化容器识别

迁移函数：
- `getStableQuestionCardContainers()`
- `detectStructuredQuestionContainers()`
- `buildStableStructuredContainerCandidates()`
- `findQuestionContainer()`
- `isInsideAnyContainer()`
- `isLikelyQuestionContext()`

**导出接口**：
```typescript
export function detectStructuredQuestionContainers(): Element[];
export function getStableQuestionCardContainers(): Element[];
export function buildStableStructuredContainerCandidates(
  containers: Element[],
  hostRightCutX: number,
  vw: number,
  vh: number
): QuestionBlock[];
```

---

### 新建文件 4: `domDetectorElements.ts` (~150 行)
**职责**：候选元素收集与过滤

迁移函数：
- `collectCandidateElements()`
- `isLikelyNavigationElement()`
- `isElementVisible()`
- `scanIframes()`

**导出接口**：
```typescript
export function collectCandidateElements(): Element[];
export function isElementVisible(el: HTMLElement): boolean;
export function scanIframes(vw: number, vh: number): QuestionBlock[];
```

---

### 新建文件 5: `domDetectorViewport.ts` (~120 行)
**职责**：视口和几何计算

迁移函数：
- `inViewport()`
- `getHostRightSidebarCutX()`
- `applyRightCutToRect()`
- `applyRightCutToBbox()`

**导出接口**：
```typescript
export function inViewport(rect: DOMRect, vw: number, vh: number): boolean;
export function getHostRightSidebarCutX(vw: number, vh: number): number;
export function applyRightCutToRect(rect: DOMRect, cutX: number): DOMRect | null;
export function applyRightCutToBbox(bbox: BoundingBox, cutX: number): BoundingBox;
```

---

### 保留在 `domDetector.ts` (~240 行)
**职责**：主检测流程和公共 API

保留函数：
- `watchForPageChanges()` - 公共 API
- `detectCandidatesInViewport()` - 核心编排
- 核心检测逻辑（调用子模块组装）

---

## 重构步骤（按优先级）

### 步骤 1：提取平台模块（低风险）
1. 创建 `domDetectorPlatforms.ts`
2. 移动 Pintia 相关函数
3. 更新 `domDetector.ts` 导入
4. 运行测试验证

### 步骤 2：提取评分系统（中风险）
1. 创建 `domDetectorScoring.ts`
2. 移动评分函数
3. 统一评分接口
4. 运行测试验证

### 步骤 3：提取容器识别（中风险）
1. 创建 `domDetectorContainers.ts`
2. 移动容器相关函数
3. 更新主检测流程
4. 运行测试验证

### 步骤 4：提取元素收集（低风险）
1. 创建 `domDetectorElements.ts`
2. 移动元素收集函数
3. 更新主检测流程
4. 运行测试验证

### 步骤 5：提取视口计算（低风险）
1. 创建 `domDetectorViewport.ts`
2. 移动几何计算函数
3. 运行测试验证

---

## 预期收益

### 可维护性提升
- 主文件从 1140 行 → ~240 行（减少 79%）
- 每个子模块 < 250 行，符合最佳实践
- 职责清晰，易于理解和修改

### 测试覆盖改善
- 当前 68.78% → 目标 85%+
- 独立模块更易编写单元测试

---

## 时间估算

- 步骤 1（平台）：2 小时
- 步骤 2（评分）：3 小时
- 步骤 3（容器）：3 小时
- 步骤 4（元素）：2 小时
- 步骤 5（视口）：1.5 小时
- 测试与验证：2 小时

**总计**：约 13.5 小时（2 个工作日）
