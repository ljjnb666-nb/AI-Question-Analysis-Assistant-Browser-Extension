# 题目解析助手 · Chrome Extension

> 在任意网页中截图识题，AI 即时解析，悬浮弹窗展示答案 — 无需切换标签页。

![Version](https://img.shields.io/badge/version-0.2.0-blue)
![MV3](https://img.shields.io/badge/Chrome-MV3-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)

---

## 功能概览

| 功能 | 说明 |
|---|---|
| 📷 手动截图 | 拖拽框选任意题目区域，支持反向拖拽 |
| 🖼 图题增强 | 强制走视觉链路，适合几何/函数图/表格题 |
| 🔍 自动识题 | DOM 扫描当前屏题目，高亮候选块 |
| 📋 批量解析 | 侧边栏勾选多题，一键批量解析 |
| 💬 悬浮弹窗 | 可拖动、可缩放、可最小化，Shadow DOM 隔离样式 |
| 🤖 多 AI 提供商 | 支持 Anthropic、OpenAI、DeepSeek、Gemini、通义千问、Kimi、智谱、Ollama |
| 📜 历史记录 | 自动保存最近 50 条解析记录 |
| ⚙️ 完整设置 | API Key、模型选择、路由策略、语言、连接测试 |

---

## 快速上手

### 1. 构建

```bash
# 需要 Node.js >= 18
cd quiz-solver-ext
npm install
npm run build        # 产物在 dist/
# 开发模式（文件变更自动重建）
npm run dev
```

### 2. 加载到 Chrome

1. 打开 `chrome://extensions/`
2. 右上角开启「**开发者模式**」
3. 点击「**加载已解压的扩展程序**」
4. 选择 `dist/` 文件夹
5. 工具栏出现 📘 图标即成功

### 3. 配置 API Key（可选）

不配置时使用 Mock 演示数据，配置后获得真实 AI 解析：

1. 点击插件图标 → 「📋 候选列表 / 设置」
2. 切换到「⚙️ 设置」标签
3. 选择 AI 提供商 → 填入 API Key → 点「🔌 连接测试」
4. 保存

---

## 使用指南

### 手动截图（主流程）

```
点击插件图标
  → 📷 手动截图
  → 页面出现半透明遮罩，鼠标变十字
  → 拖拽框选题目
  → 工具条：解析此题 | 🖼 图题增强 | 重选 | 取消
  → 弹窗出现，~1s 后显示答案
```

**弹窗操作：**
- 拖动标题栏移动位置
- 拖动右下角三角缩放大小
- 点「—」最小化为胶囊；点胶囊恢复
- 置信度低时出现紫色提示「切换图题增强」
- 「复制答案」复制「答案 + 简短解析」
- 「再截一题」关闭当前弹窗并立即进入截图态
- 「反馈错误」打开内嵌面板（自动填充上下文信息）

### 自动识题（M4）

```
点击插件图标
  → 🔍 自动识别当前屏题目
  → 侧边栏打开，题目候选块蓝色高亮
  → 勾选想解析的题目
  → 点「解析 N 题」批量解析
  → 每题显示答案和简短解析
```

点击候选卡片右侧 👁 图标，页面对应题目闪烁高亮并滚动到视野。

### 图题增强

适用场景：几何图、函数图像、表格、电路图、含"如图所示"的题目。

触发方式：
- 工具条点击「🖼 图题增强」
- 弹窗低置信度提示处点「🖼 切换」
- 解析失败后点「🖼 图题增强」
- 设置页将路由改为「视觉优先」

---

## 支持的 AI 提供商

| 提供商 | 图片支持 | 推荐模型 | 获取 Key |
|---|---|---|---|
| 🟠 **Anthropic Claude** | ✅ | claude-opus-4-5 | [console.anthropic.com](https://console.anthropic.com) |
| 🟢 **OpenAI GPT** | ✅ | gpt-4o | [platform.openai.com](https://platform.openai.com) |
| 🔵 **DeepSeek** | ❌ 纯文字 | deepseek-chat | [platform.deepseek.com](https://platform.deepseek.com) |
| 🔷 **Google Gemini** | ✅ | gemini-2.0-flash | [aistudio.google.com](https://aistudio.google.com) |
| 🟡 **通义千问** | ✅ | qwen-vl-max | [dashscope.aliyun.com](https://dashscope.aliyun.com) |
| 🌙 **Kimi** | ❌ 纯文字 | moonshot-v1-8k | [platform.moonshot.cn](https://platform.moonshot.cn) |
| 🔮 **智谱 GLM** | ✅ | glm-4v-flash | [open.bigmodel.cn](https://open.bigmodel.cn) |
| 🦙 **Ollama 本地** | ✅ | llava | [ollama.com](https://ollama.com) |

**自定义 Base URL**：OpenAI 和 Ollama 支持填入代理/自托管地址。

---

## 项目结构

```
src/
├── manifest.json                    # MV3 清单
├── icons/                           # 插件图标 16/48/128px
├── background/
│   └── background.ts                # Service Worker：截图调度、消息路由、侧边栏
├── popup/
│   ├── popup.html
│   ├── popup.tsx
│   └── PopupApp.tsx                 # 启动入口 UI
├── content/
│   ├── content-main.ts              # 内容脚本编排器
│   ├── overlay/
│   │   ├── CaptureOverlay.ts        # 截图遮罩 + 拖拽选区
│   │   └── CaptureToolbar.ts        # 选区后工具条（含图题增强）
│   ├── floating/
│   │   ├── FloatingWindow.tsx        # 弹窗 React 组件
│   │   └── FloatingWindowManager.ts # 弹窗生命周期（Shadow DOM）
│   ├── detector/
│   │   └── domDetector.ts           # DOM 规则识题算法
│   └── highlight/
│       └── HighlightLayer.ts        # 候选块高亮层
├── sidepanel/
│   ├── sidepanel.html
│   ├── sidepanel.tsx
│   └── SidePanelApp.tsx             # 三标签页：候选题/历史/设置
└── shared/
    ├── types/
    │   └── index.ts                 # 所有类型定义 + 消息协议
    └── utils/
        ├── analytics.ts             # 事件埋点（17种事件）
        ├── bbox.ts                  # BBox 归一化、缩放、clamp、边界吸附
        ├── cropImage.ts             # Canvas 截图裁剪
        ├── messaging.ts             # 类型安全消息总线
        ├── ocr.ts                   # 图像分析 + 视觉关键词检测
        ├── parseRouter.ts           # 8家AI提供商路由 + Mock 兜底
        └── storage.ts               # chrome.storage 封装（状态/设置/历史）
```

---

## 消息协议

所有跨上下文通信通过统一消息类型，不允许随意耦合：

```typescript
// Popup → Background → Content
START_MANUAL_CAPTURE      // 启动截图
START_AUTO_DETECT         // 启动自动识题

// Content → Background
CAPTURE_TAB_SCREENSHOT    // 请求截图（需要 background 权限）

// Background → Content (relay)
TAB_SCREENSHOT_READY      // 截图完成回调

// Content → Runtime (sidepanel)
AUTO_DETECT_RESULT_READY  // 候选题列表

// Content → Content (internal)
HIGHLIGHT_CANDIDATE       // 闪烁定位候选块
CLEAR_HIGHLIGHTS          // 清除所有高亮
CLOSE_FLOATING_RESULT     // 关闭弹窗
```

---

## 开发指南

### 类型检查

```bash
npm run typecheck
```

### 添加新的 AI 提供商

编辑 `src/shared/utils/parseRouter.ts`：

```typescript
// 1. 在 PROVIDERS 数组添加配置
{
  id: "myprovider",
  name: "我的提供商",
  baseUrl: "https://api.example.com",
  defaultModel: "my-model",
  models: ["my-model", "my-model-pro"],
  supportsVision: true,
  openaiCompat: true,       // 如果兼容 OpenAI 格式
  authHeader: "bearer",
  keyPlaceholder: "sk-...",
}

// 2. 如果不是 OpenAI 兼容格式，在 parseQuestion() 里添加分支：
if (provider.id === "myprovider") {
  result = await callMyProvider(block, route, settings);
}
```

### 里程碑进度

| 里程碑 | 状态 |
|---|---|
| M1 工程骨架 | ✅ |
| M2 手动截图闭环 | ✅ |
| M3 弹窗完善（Shadow DOM/拖动/缩放/最小化/边界吸附） | ✅ |
| M4 自动识题+高亮+侧边栏+批量解析 | ✅ |
| M5 OCR路由+8家AI+图题增强 | ✅ |
| M6 埋点+错误处理+反馈面板 | ✅ |
| V2 整页滚动采集 | ⏳ 规划中 |
| V2 登录/会员/配额 | ⏳ 规划中 |

---

## 已知限制

| 限制 | 说明 |
|---|---|
| 跨域 iframe | 内容脚本无法访问跨域 iframe 内的内容 |
| PDF 嵌入页面 | 浏览器内嵌 PDF 阅读器无法截图 |
| DeepSeek/Kimi 不支持图片 | 这两个提供商当前仅支持文字路由 |
| Ollama 需本地运行 | 需先安装并运行 `ollama serve` |
| 自动识题准确率 | DOM 规则识题在非标准页面结构可能漏识或误识 |

---

## 许可

MIT License
