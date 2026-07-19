# 手动测试指南

## 扩展加载步骤

1. **打开 Edge 浏览器**
   - 地址栏输入：`edge://extensions/`
   - 或点击右上角 `...` → 扩展 → 管理扩展

2. **启用开发者模式**
   - 打开页面左下角的「开发人员模式」开关

3. **加载扩展**
   - 点击「加载解压缩的扩展」
   - 选择目录：`C:\Users\LJJ2004\所有项目\quiz-solver-ext\dist`
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
  // 应该看到加密后的 base64 字符串，而不是明文
});
```

**预期结果：**
- ✅ API Key 以加密形式存储（长 base64 字符串）
- ✅ 重新打开设置页面，API Key 正确解密显示
- ✅ 不会看到明文 `sk-test-key-12345`

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

```bash
cd C:\Users\LJJ2004\所有项目\quiz-solver-ext

# 运行所有测试
npm run test:run

# 类型检查
npm run typecheck

# 构建验证
npm run build
```

**预期输出：**
```
✅ Test Files  4 passed (4)
✅ Tests      37 passed (37)
✅ TypeScript check passed
✅ Build completed successfully
```
