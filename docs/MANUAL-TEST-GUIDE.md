# 手动测试指南

## 扩展加载步骤

1. **打开 Edge 浏览器**
   - 地址栏输入：`edge://extensions/`
   - 或点击右上角 `...` → 扩展 → 管理扩展

2. **启用开发者模式**
   - 打开页面左下角的「开发人员模式」开关

3. **加载扩展**
   - 点击「加载解压缩的扩展」
   - 选择目录：项目仓库根目录下的 `dist/`（先运行 `npm run build` 生成）
   - 扩展应该出现在列表中，图标为 📘

## P0 改进功能测试

### 测试 1: 加密存储验证

**目的：验证 API Key 加密存储功能**

1. 点击扩展图标 → 「📋 候选列表 / 设置」
2. 切换到「⚙️ 设置」标签
3. 选择任意 AI 提供商（如 Anthropic）
4. 输入测试 API Key：`sk-test-key-12345`
5. 点击「保存设置」

**验证步骤：**
```javascript
// 在浏览器控制台执行
chrome.storage.local.get('appSettings', (result) => {
  console.log('Stored API Key:', result.appSettings.apiKey);
  // 应该看到 qse:v1:<base64> 格式的密文，而不是明文
});
```

**预期结果：**
- ✅ API Key 以 `qse:v1:<base64>` 形式存储（版本化密文 envelope）
- ✅ 重新打开设置页面，API Key 正确解密显示
- ✅ 不会看到明文 `sk-test-key-12345`
- ℹ️ 这是本地 encrypted-at-rest 表示，用于防止意外看到明文；不是 OS 级秘密保险库（详见 [API-KEY-SECURITY.md](./API-KEY-SECURITY.md)）

---

### 测试 2: 错误日志系统验证

**目的：验证统一错误日志功能**

1. 打开任意网页（如 https://example.com）
2. 打开浏览器开发者工具（F12）
3. 切换到 Console 标签
4. 点击扩展图标 → 「📷 手动截图」
5. 随意框选一个区域
6. 观察控制台输出

**预期结果：**
- ✅ 看到结构化的日志输出（带上下文）
- ✅ 错误信息包含时间戳、上下文、堆栈
- ✅ 不再有静默失败

---

### 测试 3: 核心功能回归测试

**目的：确保 P0 改进没有破坏现有功能**

#### 3.1 手动截图
1. 打开测试页面：https://www.example.com
2. 点击扩展图标 → 「📷 手动截图」
3. 拖拽框选页面标题区域
4. 点击「解析此题」

**预期结果：**
- ✅ 截图遮罩正常显示
- ✅ 拖拽选区流畅
- ✅ 悬浮窗正常弹出
- ✅ Mock 数据正常显示（未配置 API Key 时）

---

## 自动化测试验证

在项目仓库根目录执行：

```bash
# 提交前默认本地检查（lint + typecheck + 单元测试）
npm run check

# 构建验证
npm run build

# 构建产物 + 权限契约验证
npm run verify:artifact

# 权限验证器单元测试
npm run test:permissions

# 真实扩展 E2E（会先重新构建扩展）
npm run test:e2e
```

**预期结果：** 以上每条命令都必须以退出码 0 结束。本指南不硬编码测试文件数/用例数等易漂移指标；以命令实际输出为准。

---

## 发布前手动检查（Release Manual Checks）

除自动化门禁外，每次发布前在真实 Chrome/Edge 中完成以下手动检查：

1. **加载产物**
   - 在 Chrome/Edge MV3（`chrome://extensions` / `edge://extensions` 开发者模式）加载仓库构建出的 `dist/`，扩展正常出现且无加载报错。

2. **登录与启动会话校验**
   - 注册/登录后刷新或重开 popup / Side Panel，界面基于服务端会话校验结果解锁；服务端会话失效时 UI 回到未登录状态，不凭本地缓存直接放行。

3. **Analytics 默认关闭**
   - 全新配置下确认 analytics 默认为 OFF，不产生任何上报请求；设置页中能看到「Usage Analytics / 使用情况统计」控件，显式开启后才发送。

4. **API Key 保存形态**
   - 保存设置后，`chrome.storage.local` 中的 API Key 应为 `qse:v1:<base64>` 版本化密文 envelope（见上文测试 1）。
   - 文档口径：这是本地 encrypted-at-rest 混淆表示，**不是秘密保险库**（详见 [API-KEY-SECURITY.md](./API-KEY-SECURITY.md)）。

5. **基础检测/解析/填充**
   - 手动截图 → 解析 → 填充基本流程可用，填充后有权威回读确认。

6. **确认无自动提交**
   - 确认整个流程只做解析与填充，**不会自动提交答案**；提交动作始终由用户自己控制。

7. **已知浏览器限制记录**
   - 按需记录已知限制的实测表现（如关闭的 shadow root 不可遍历、跨域 iframe 不注入、portal 控件 fail-closed 等），与 [COMPATIBILITY-MATRIX.md](./COMPATIBILITY-MATRIX.md) 的已知限制口径保持一致。
