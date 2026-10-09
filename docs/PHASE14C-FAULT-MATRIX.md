# Phase 14C — ARCH_01 故障模型与首个最小切片（2026-10-09）

## 基线与审计边界

- GitHub main 起点：`5aace526d8bebc955413a84b9824de3fe9e8abc0`；PR #79 已合并。
- 核验 CI run `37891469316`：main SHA 一致、attempt 1、9/9 jobs PASS。
- 本记录基于 GitHub 代码阅读。不能以此声称已经验证 Windows 本地工作树、已执行新增本地 Vitest，或完成 Phase 13B 真实授权网站测试。
- 最高不变量：`NO_AUTOMATIC_SUBMISSION`；禁止任何后台自动提交行为。

## 生产调用链与所有权

```text
Popup/Side Panel --START + generationId--> contentMessageRouter
  -> protectedWorkRunAuthority (kind + local execution lease + generation)
  -> contentMainWorkflows (URL + route epoch + execution-current fence)
  -> autoSolveOrchestration
  -> contentAutoSolveRuntimeBridge (attempt controller + question revision)
  -> parseRetryPipeline (tier timeouts + streaming fallback)
  -> withParseTimeout (child AbortSignal)
  -> parseRouter (runtime/config/credential + beforeDispatch + MAX_RETRIES)
  -> providerClients (HTTP headers + JSON/SSE/error response body)
  -> parseRouter (stale revision recheck + source authority)
  -> runtimeBridge (result -> exact attempt via WeakMap)
  -> history / transactionalExecutor (fresh mapping, current owner, rollback)
  -> progress/DONE (generation fence)
```

本链有多层异步边界，各层必须保留自己的 lease/fence；HTTP 收到响应头不等于业务结果已完成，也不授予填答权限。

## 故障矩阵（针对现有保护作审计，不是全部已通过的声明）

| 故障 | 现有措施 / 证据位置 | 剩余风险 / 14C 处理 |
| --- | --- | --- |
| 旧 G1 provider 结果晚于 G2 | `parseRouter` 在结果返回后重新校验 revision；`contentAutoSolveRuntimeBridge` 的 attempt WeakMap；Phase 14B late-provider E2E | 已有主要回归，14C 复用、只补遗漏 |
| 旧 STOP、DONE 跨 owner | `protectedWorkRunAuthority` generation/lease 和 Phase 14B 浏览器回归 | 复用；继续检查无 generation 的旧消息兼容路径 |
| 路由或 DOM 变化后填答 | `contentMainWorkflows` URL/epoch；`transactionalExecutor` live owner/controls | 已有防护；跨事件重入需补故障注入 |
| 认证变化后旧任务完成 | auth coordinator + protected work termination + Phase 14B auth E2E | 有回归，缺少针对每个传输阶段的覆盖 |
| HTTP 头已到、正常响应体永不结束 | 基线 `fetchWithTimeout` 在 `fetch()` resolve 时清除 timer，后续 `response.json()`/SSE 在范围外 | **14C-01：已定位真实超时所有权缺口；改为覆盖整个消费阶段** |
| HTTP 4xx/5xx 错误正文永不结束 | `boundedResponseError` 限制文本长度，但等待 `reader.read()` 不限时 | **14C-01：同一超时边界、可控错误流测试** |
| Abort 后流式旧片段到达 | 上层 stale-result fence 保护结果提交；此前流式消费未独立检查中断 | **14C-01：单条事件与下一次读取前进行 signal fence** |
| Provider 自动重试与上层 tier 重试相乘 | `parseRouter` MAX_RETRIES + `parseRetryPipeline` tier 路由 | **14C-02：统计实际 dispatch 次数、确认 retry budget 和取消即停止** |
| 重复 START/PROGRESS/DONE 消息 | `protectedWorkRunAuthority` 与 Phase 14B generation E2E | **14C-03：乱序/重复消息故障注入，重点查旧协议退化路径** |
| Popup/Side Panel 同时控制、Tab/iframe 并行 | Phase 14B 工作 lease + Phase 14B E2E | 复用；剩余多 surface 竞争矩阵纳入 14C-04 |
| SSE 帧跨 chunk 拆分 / 未收终止帧 | `consumeOpenAIStream` 与 `consumeAnthropicStream` 逐 chunk 分行 | **14C-02/03：测试帧拆分、无界输出与终止事件处理** |
| 大体积成功 JSON、无终止 SSE | 失败文本已设 8192 字节上限；成功体和聚合流文本尚无显式统一上限 | **14C-05：资源预算及溢出失败闭合** |
| 真实授权学习平台 | 13B 本地只读工具 | `AUTH_REQUIRED_NOT_RUN`，不能替换为模拟证明 |

## 14C-01 scoped PR

只改 `src/shared/ai/providerClients.ts` 并增加 `src/shared/ai/providerResponseTimeout.phase14c.test.ts`。测试使用生产调用函数和可控响应体，覆盖三个 provider 的 200 响应头后 JSON stall、HTTP 错误正文 stall、SSE abort/late emission。

- 对外 HTTP 发送仍需要 `beforeDispatch` 校验；credential、redirect=error 与日志脱敏规则不变。
- 30s 传输 attempt timeout 延伸至响应体消费结束；外部 Abort 立即拒绝。客户端下层收到 headers 不能提前结束 timer。
- 30s transport timeout 不等于整个业务流程唯一超时：`withParseTimeout` 仍拥有 tier 级租约。
- 不修改 UI、DOM 解析、答案填写、人工提交、Auth 数据结构或发布/CI。
- 任何 GitHub Actions 结果需绑定新的 PR HEAD；本文件不能替代实际测试执行。
