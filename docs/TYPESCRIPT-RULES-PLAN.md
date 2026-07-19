# TypeScript 规则收紧计划

**当前状态**：多个类型安全规则被关闭

**目标**：逐步启用类型安全规则，提升代码质量

---

## 当前被关闭的规则

```javascript
"@typescript-eslint/no-explicit-any": "off",
"@typescript-eslint/no-unused-vars": "off",
"@typescript-eslint/require-await": "off",
"@typescript-eslint/unbound-method": "off",
"@typescript-eslint/no-base-to-string": "off",
"@typescript-eslint/no-unsafe-assignment": "off",
"@typescript-eslint/no-unsafe-argument": "off",
"@typescript-eslint/no-unsafe-call": "off",
"@typescript-eslint/no-unsafe-member-access": "off",
"@typescript-eslint/no-unsafe-return": "off",
"@typescript-eslint/no-unnecessary-type-assertion": "off",
```

---

## 分阶段收紧策略

### Phase 1: 低风险规则（立即启用）

#### 1.1 启用 `no-unused-vars: "warn"`
**影响**：警告未使用的变量，不阻止构建

**操作**：
```javascript
"@typescript-eslint/no-unused-vars": ["warn", {
  "argsIgnorePattern": "^_",
  "varsIgnorePattern": "^_"
}]
```

**清理**：约 20 处未使用变量（通过 `npm run lint` 识别）

---

#### 1.2 启用 `require-await: "warn"`
**影响**：警告没有 await 的 async 函数

**操作**：
```javascript
"@typescript-eslint/require-await": "warn"
```

**清理**：检查并移除不必要的 async 关键字

---

#### 1.3 启用 `no-unnecessary-type-assertion: "warn"`
**影响**：警告不必要的类型断言

**操作**：
```javascript
"@typescript-eslint/no-unnecessary-type-assertion": "warn"
```

**清理**：移除冗余的 `as Type` 断言

---

### Phase 2: 中等风险规则（2 周后）

#### 2.1 限制 `no-explicit-any: "warn"`
**影响**：警告使用 `any` 类型

**操作**：
```javascript
"@typescript-eslint/no-explicit-any": ["warn", {
  "ignoreRestArgs": true
}]
```

**清理策略**：
1. 搜索所有 `any` 使用：`grep -r ": any" src/`
2. 按优先级替换：
   - `unknown` - 当不知道类型时
   - 具体类型 - 当知道结构时
   - 泛型 `<T>` - 当需要类型参数时
   - `Record<string, unknown>` - 对象字典
3. 允许保留 `any` 的场景：
   - 第三方库类型缺失
   - 动态 JSON 解析（考虑 Zod）
   - 测试 mock（考虑 `vi.fn<any, any>()`）

**预估工作量**：约 50-80 处 `any` 需要替换

---

#### 2.2 启用 `no-base-to-string: "warn"`
**影响**：警告对象直接转字符串

**操作**：
```javascript
"@typescript-eslint/no-base-to-string": "warn"
```

**清理**：检查 `String(obj)` 调用，使用 `JSON.stringify()` 或自定义 toString

---

### Phase 3: 高风险规则（1 个月后）

#### 3.1 启用 `no-unsafe-*` 系列警告
**影响**：警告所有不安全的 `any` 操作

**操作**：
```javascript
"@typescript-eslint/no-unsafe-assignment": "warn",
"@typescript-eslint/no-unsafe-argument": "warn",
"@typescript-eslint/no-unsafe-call": "warn",
"@typescript-eslint/no-unsafe-member-access": "warn",
"@typescript-eslint/no-unsafe-return": "warn"
```

**清理策略**：
- 这些规则依赖 Phase 2 完成（减少 `any` 使用）
- 逐个模块清理，优先核心模块：
  1. `src/shared/types/`
  2. `src/shared/utils/`
  3. `src/shared/ai/`
  4. `src/content/detector/`
  5. `src/sidepanel/`

**预估工作量**：约 100-150 处需要修复

---

### Phase 4: 严格模式（长期目标）

#### 4.1 将所有规则从 "warn" 改为 "error"
**时机**：覆盖率达到 80% 且所有警告清理完毕

**操作**：
```javascript
"@typescript-eslint/no-explicit-any": "error",
"@typescript-eslint/no-unused-vars": "error",
// ... 其他规则
```

---

## 实施时间表

| 阶段 | 规则 | 时间 | 工作量 |
|------|------|------|--------|
| Phase 1 | unused-vars, require-await, unnecessary-type-assertion | 立即 | 2 小时 |
| Phase 2 | no-explicit-any (warn), no-base-to-string | 2 周后 | 8 小时 |
| Phase 3 | no-unsafe-* 系列 (warn) | 1 月后 | 15 小时 |
| Phase 4 | 全部改为 error | 3 月后 | 持续优化 |

---

## 配置变更示例

### 当前配置
```javascript
rules: {
  "@typescript-eslint/no-explicit-any": "off",
  "@typescript-eslint/no-unused-vars": "off",
  // ...
}
```

### Phase 1 后配置
```javascript
rules: {
  "@typescript-eslint/no-explicit-any": "off", // Phase 2 再启用
  "@typescript-eslint/no-unused-vars": ["warn", {
    "argsIgnorePattern": "^_",
    "varsIgnorePattern": "^_"
  }],
  "@typescript-eslint/require-await": "warn",
  "@typescript-eslint/no-unnecessary-type-assertion": "warn",
  // ...
}
```

---

## 监控指标

### 成功指标
- ESLint 警告数量逐月下降
- 新增代码 0 `any` 使用（通过 pre-commit hook）
- TypeScript 编译错误减少

### 追踪方式
```bash
# 统计当前 any 使用
grep -r ": any" src/ | wc -l

# 统计 ESLint 警告
npm run lint 2>&1 | grep "warning" | wc -l
```

---

## 风险与缓解

### 风险 1：大量现有代码需要修改
**缓解**：
- 使用 "warn" 而非 "error"，不阻止开发
- 增量修复，优先核心模块
- 允许特殊情况使用 `// eslint-disable-next-line`

### 风险 2：影响开发速度
**缓解**：
- 新代码强制执行，旧代码渐进式修复
- 提供类型定义模板和最佳实践文档
- 团队培训：如何正确使用 `unknown` 和泛型

### 风险 3：过度类型化降低灵活性
**缓解**：
- 允许合理使用 `unknown`
- 允许合理使用 `@ts-expect-error` 带注释
- 对第三方库类型缺失提供 `.d.ts` 补充

---

## 下一步行动

1. ✅ 创建本收紧计划
2. 🔄 执行 Phase 1（启用低风险规则）
3. 🧹 清理 Phase 1 产生的警告
4. 📊 统计当前 `any` 使用基线
5. 📅 2 周后启动 Phase 2
6. 📝 更新团队编码规范文档

---

## 参考资源

- [TypeScript ESLint Rules](https://typescript-eslint.io/rules/)
- [TypeScript Handbook - Type Checking](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html)
- [Effective TypeScript: 83 Specific Ways](https://effectivetypescript.com/)
