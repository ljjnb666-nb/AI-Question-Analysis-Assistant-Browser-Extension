# Quiz Solver Extension

这是一个 Chrome MV3 扩展，用于在常规 `http(s)` 页面上进行题目截图、DOM 检测、AI 解析、批量填充和引导式自动答题。

## 主要能力

- 手动框选题目区域进行截图
- 支持视口内和整页题目检测
- Side Panel 中支持批量解析和批量填充
- 悬浮结果窗口，带持久化状态
- auto-solve 自动解析/填充流程，包含重试和复核启发式
- 多个 AI 提供方，通过统一解析层路由
- 可选本地 analytics/auth 后端，用于操作侧统计与鉴权

## 项目结构

```text
analytics-server/ 本地 analytics/auth 后端
docs/             架构、配置和测试文档
e2e/              Playwright 扩展冒烟测试
src/
  background/     MV3 service worker
  content/        页面侧截图、检测、高亮、自动答题
  popup/          Popup 入口
  sidepanel/      操作界面与批量流程
  shared/         协议、鉴权 UI、解析、存储、通用工具
tools/            构建辅助脚本
```

## 文档导航

- [docs/README.md](./docs/README.md)：文档索引
- [docs/RELEASE-READINESS.md](./docs/RELEASE-READINESS.md)：release hardening 状态、冻结不变量与已知限制
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)：模块边界与重构约束
- [docs/COMPATIBILITY-MATRIX.md](./docs/COMPATIBILITY-MATRIX.md)：DOM 兼容性语料与已知安全限制
- [docs/PERMISSIONS.md](./docs/PERMISSIONS.md)：生产权限契约与运行时依据
- [PRIVACY.md](./PRIVACY.md)：数据流与隐私说明
- [docs/API-KEY-SECURITY.md](./docs/API-KEY-SECURITY.md)：本地 API Key 存储威胁模型
- [docs/MANUAL-TEST-GUIDE.md](./docs/MANUAL-TEST-GUIDE.md)：手工验证流程
- [docs/ANALYTICS-AUTH.md](./docs/ANALYTICS-AUTH.md)：本地 analytics/auth 后端配置说明

## 开发

安装依赖：

```bash
npm install
```

监听模式构建扩展：

```bash
npm run dev
```

生成可直接加载的扩展产物：

```bash
npm run build
```

在 `chrome://extensions` 中开启开发者模式后加载 `dist/`。`dist/` 属于构建产物，应当本地重新生成，不要手工修改。

## 本地 Analytics/Auth 后端

测试统计、鉴权或独立管理后台相关流程时，先构建并验证 Admin Console，再启动本地后端：

```bash
npm run build:admin
npm run verify:admin
npm run analytics:server
```

管理后台入口为 `/admin`，其构建产物位于独立的 `dist-admin/`，不会进入扩展 `dist/`。后端代码位于 `analytics-server/`，生产运行时使用 Node.js 24 + SQLite。安全说明和本地配置见 [docs/ANALYTICS-AUTH.md](./docs/ANALYTICS-AUTH.md)。

## 质量检查

```bash
npm run lint
npm run typecheck
npm run test:run
npm run test:e2e
npm run check
```

- `npm run check` 是提交前默认本地检查。
- `npm run test:e2e` 会先重新构建扩展，再执行 Playwright；`npm run test:e2e:dist` 只测试现有的 `dist/`，不会重新构建。
- CI 分别运行 `check`、生产构建与 artifact 验证、真实扩展 E2E。E2E 使用构建 job 上传的同一份已验证 artifact；artifact verifier 会按最终 manifest 检查运行时文件路径。

## 说明

- auto-solve 指自动解析/填充工作流。The extension does not automatically submit answers; submission remains user-controlled. 插件不会自动提交答案，提交动作仍由用户控制。
- 扩展只会注入 `http://*/*` 和 `https://*/*` 页面，浏览器内部页面会被刻意排除。
- `npm run build:raw` 仅在你明确需要原始 Vite 输出时使用；正常打包流程应使用 `npm run build`。
