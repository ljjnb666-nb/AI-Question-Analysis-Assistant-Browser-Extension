# 题目解析助手 Chrome Extension

一个基于 Chrome MV3 的题目识别与解析扩展。

它支持：
- 手动框选题目区域并调用 AI 解析
- 自动扫描当前视口或整页题目
- 在侧边栏批量解析、批量填写
- 自动答题流程编排
- 多 AI 提供商与图题增强

![Version](https://img.shields.io/badge/version-0.2.0-blue)
![MV3](https://img.shields.io/badge/Chrome-MV3-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)

## 功能概览

| 功能 | 说明 |
|---|---|
| 手动截图 | 框选任意题目区域并立即解析 |
| 图题增强 | 对几何图、函数图、表格题优先走视觉链路 |
| 自动识题 | DOM 扫描当前屏或整页题目并高亮候选块 |
| 批量解析 | 在侧边栏勾选多题后统一解析 |
| 批量填写 | 对已解析题目批量回填答案 |
| 自动答题 | 按题序推进、复用历史、自动复核与跳转 |
| 历史记录 | 保存解析记录与低置信度回看依据 |
| 多提供商 | OpenAI、Anthropic、Gemini、DeepSeek、Qwen、GLM、MiniMax、Kimi、Ollama |

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 构建

```bash
npm run build
```

产物输出到 `dist/`。

开发模式：

```bash
npm run dev
```

### 3. 加载到 Chrome

1. 打开 `chrome://extensions/`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 `dist/`

### 4. 配置 AI

1. 打开扩展侧边栏或弹窗
2. 进入“设置”
3. 选择 provider、模型和 API Key
4. 保存并测试连接

## 常用命令

```bash
npm run dev
npm run build
npm run typecheck
npm run test:run
```

## 当前架构

这轮重构后的目标是：
- 降低总控文件耦合
- 把“编排”和“实现细节”分离
- 让 sidepanel / content script 都退化为薄门面

### Content 侧

核心入口：
- `src/content/content-main.ts`

当前职责：
- 维护 content script 运行时状态
- 装配 bridge / orchestration / service 依赖
- 处理消息入口与少量生命周期逻辑

主要拆分模块：
- `src/content/contentDetectionBridge.ts`
  负责自动识题、整页识题相关依赖装配
- `src/content/autoSolveOrchestration.ts`
  负责自动答题主循环编排
- `src/content/contentAutoSolveRuntimeBridge.ts`
  负责自动答题运行时包装函数与 runtime 发送
- `src/content/contentCaptureBridge.ts`
  负责截图与图像裁剪桥接
- `src/content/contentQuestionServices.ts`
  负责题面抽取、文本归一化、题块解析
- `src/content/formulaEmbedFallback.ts`
  负责公式 embed fallback 安装层
- `src/content/formulaSvgSemantic.ts`
  负责 SVG 公式语义解析

### Sidepanel 侧

核心入口：
- `src/sidepanel/SidePanelApp.tsx`

当前职责：
- 管理顶层状态
- 绑定批量操作
- 切换 tab

主要拆分模块：
- `src/sidepanel/CandidatesTab.tsx`
  负责候选题主视图区
- `src/sidepanel/candidateViews.tsx`
  负责候选卡片与自动答题预览卡
- `src/sidepanel/candidateViewParts.tsx`
  负责候选卡片子块复用组件
- `src/sidepanel/sidepanelMessageBridge.ts`
  负责 runtime message / storage 监听桥
- `src/sidepanel/sidepanelCandidateMetrics.ts`
  负责候选题统计与过滤
- `src/sidepanel/displayQuestionText.ts`
  负责题面清洗、分段、展示文本
- `src/sidepanel/displayAnswerUtils.ts`
  负责答案展示推断与规范化

## 目录结构

```text
src/
├── manifest.json
├── background/
│   └── background.ts
├── popup/
│   ├── popup.html
│   ├── popup.tsx
│   └── PopupApp.tsx
├── content/
│   ├── content-main.ts
│   ├── contentDetectionBridge.ts
│   ├── contentAutoSolveRuntimeBridge.ts
│   ├── autoSolveOrchestration.ts
│   ├── contentQuestionServices.ts
│   ├── formulaEmbedFallback.ts
│   ├── formulaSvgSemantic.ts
│   ├── detector/
│   ├── floating/
│   ├── highlight/
│   └── overlay/
├── sidepanel/
│   ├── sidepanel.html
│   ├── sidepanel.tsx
│   ├── SidePanelApp.tsx
│   ├── CandidatesTab.tsx
│   ├── candidateViews.tsx
│   ├── candidateViewParts.tsx
│   ├── sidepanelMessageBridge.ts
│   ├── sidepanelCandidateMetrics.ts
│   ├── displayQuestionText.ts
│   └── displayAnswerUtils.ts
└── shared/
    ├── types/
    └── utils/
```

## 维护性说明

当前代码的维护策略：

- 总控文件只负责装配，不直接堆算法细节
- 文本清洗、答案推断、视图渲染、自动答题编排分别分层
- 与 Chrome runtime、storage、content message 的交互都尽量走 bridge
- 算法模块和 UI 模块尽量避免双向依赖

当前主观评分：

- 低耦合度：`9.3/10`
- 易维护度：`9.3/10`

这不是绝对分数，只是基于当前代码边界、文件职责和修改成本的工程评估。

## 测试与验证

最近一次结构重构后已验证通过：

```bash
npm run typecheck
npm run test:run
npm run build
```

当前测试结果：
- `15` 个测试文件通过
- `126 passed | 2 skipped`

## 支持的 AI 提供商

| 提供商 | 图像支持 | 推荐模型 |
|---|---|---|
| Anthropic | 是 | `claude-opus-4-5` |
| OpenAI | 是 | `gpt-4o` |
| Gemini | 是 | `gemini-2.0-flash` |
| DeepSeek | 否/弱视觉链路 | `deepseek-chat` |
| Qwen | 是 | `qwen-vl-max` |
| GLM | 是 | `glm-4v-flash` |
| MiniMax | 是 | `MiniMax-M3` |
| Kimi | 主要文本 | `moonshot-v1-8k` |
| Ollama | 取决于本地模型 | `llava` |

## 已知限制

- 跨域 iframe 内部内容无法直接扫描
- 浏览器内嵌 PDF 页面支持有限
- 不同站点 DOM 结构差异较大时，自动识题准确率会下降
- 视觉模型质量会直接影响图题解析结果
- 本地 Ollama 需要用户自行启动服务

## 后续可继续优化的方向

- 给 bridge / orchestration 增加更细粒度单测
- 继续拆分 `formulaSvgSemantic.ts` 这类大算法文件
- 进一步压缩 content 与 sidepanel 中剩余的中等体积模块
- 建立更明确的架构文档与依赖边界规则

## License

MIT
