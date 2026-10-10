# RC-FREEZE-01 · 有限范围发布候选冻结评估

> 决策状态：**EVIDENCE_REVIEW_COMPLETE / FREEZE_AND_PUBLICATION_NOT_AUTHORIZED**（2026-10-10）。本文是基于一个已验收源码提交的**评估记录**，不是 Git tag、版本发布、商店上架、服务器部署或真实登录态网站兼容认证。只有经单独批准的冻结/发布动作才能改变该状态。

## 1. 证据身份与权威边界

- **已验收运行时代码基线**：main Merge Commit \`52d0b899689bdbabafd96dbbe1680aa21eb48e03\`（PR [#97](https://github.com/ljjnb666-nb/AI-Question-Analysis-Assistant-Browser-Extension/pull/97)，Phase 14D-05）。
- **该基线的独立主干 CI**：[38028912289](https://github.com/ljjnb666-nb/AI-Question-Analysis-Assistant-Browser-Extension/actions/runs/38028912289)：event=push、run_attempt=1、head_sha 精确匹配、COMPLETED/SUCCESS、9/9 jobs PASS。
- Vitest **1761/1761**（151/151 测试文件）；扩展 Chromium E2E **87/87**；Popup Soak **1000/1000**；Phase 12B 浏览器、Admin 浏览器、真实 Pintia 公共页只读验收均 PASS；RC Manifest 测试 **6/6**。
- 该 Run 的 RC v0.2.0 身份：extension tree SHA-256 \`d7db768df00628409e99479baf28fef257f37d5172f07662a5e05990f01cbb2e\`；Admin tree SHA-256 \`8da587d2e666ce0c6d88b8cebba67abb6efb3cfb4a0b8986675613bfe1349b01\`；analytics Docker image ID \`sha256:f71853841ef7eea54b32292a82bd65e0b69d31bb1cebe788a9d30dbcb5a270a7\`，同 Run 导出与恢复 ID 一致。
- **7 类产物**以完整基线 SHA 命名，查询时均非空、未过期。保留期并不永久；将来推广必须重新验证下载可用性、内容 hash、镜像恢复，以及清单和实际制品一致。
- **本文件所处的文档 PR 一旦合并，会生成另一个 main SHA**；不得把上述 Run 冒充新文档合并 SHA 的 CI。冻结最终选择哪个**准确 SHA/制品集合**，就须在该 SHA 上另行完成主干 9/9、RC 6/6 和制品身份核验，不允许以相同源码“重新构建”静默替代既有已验收镜像。

## 2. 有证据支持与不支持的产品声明

| 能力/范围 | 冻结评估允许的声明 | 禁止升级的声明 |
| --- | --- | --- |
| Chrome MV3 扩展 + Admin/分析服务候选 | 经独立主干 CI、真实浏览器和 RC 制品绑定测试的**构建候选** | 已向 Chrome Web Store 发布、已部署生产服务 |
| Pintia 公开编程题页面 | 真实 Chrome 上的**只读识题/快照**通过；无填写、翻页、提交 | 在真实 Pintia 页面上完成 AI 解答、自动填答或提交 |
| Pintia 题目列表、静态单选/判断、同源 frame、开放 Shadow DOM | 存在明确范围的离线语料及受控 E2E/权威回读证据 | 全站/所有真实 DOM、完整生产网站兼容 |
| 智慧树、Polymas 等登录态网站 | \`AUTH_REQUIRED_NOT_RUN\`（或无稳定公共目标）；脱敏回归不是现场证据 | 已登录、完成真实网站端到端识题或填答验收 |
| 跨域 iframe、closed shadow、非所有者 portal、pointerdown 自定义控件 | 按 \`KNOWN_ARCHITECTURE_LIMITATION\` / \`KNOWN_SAFE_LIMITATION\` / \`UNSUPPORTED_BY_BROWSER_SECURITY\` 披露 | 广泛兼容或保证可填 |
| 答案提交 | **NO_AUTOMATIC_SUBMISSION**：最终提交仍须用户亲自确认 | 插件可自动点击提交或代替用户交卷 |

离线 \`SUPPORTED\` 只针对给定 fixture 的契约，不是对任何外站真实会话的营销授权。见 [COMPATIBILITY-MATRIX.md](./COMPATIBILITY-MATRIX.md)、[PHASE13-REAL-SITE-ACCEPTANCE.md](./PHASE13-REAL-SITE-ACCEPTANCE.md)。

## 3. 剩余风险、责任边界与冻结决策

| 编号 | 风险与证据 | 当前决策 / 门禁 |
| --- | --- | --- |
| R1 | [Issue #83](https://github.com/ljjnb666-nb/AI-Question-Analysis-Assistant-Browser-Extension/issues/83) 真实 Pintia 的 Runner→脚本子域链路偶发在识题前失败；历史受限探针未建立 TCP，不证明服务器全局不可用或具体节点根因 | **OPEN / OWNER_UNDETERMINED**；一旦后续选定 SHA 的原始真实站点门禁失败则停止冻结/推广；不得采用 mock、隐藏失败、无依据延时或 CI 重试制造 PASS |
| R2 | 256 KiB 是最终 pretty JSON 输出预算；旧 \`chrome.storage.local.get\` 首次反序列化、恶意 Getter/Proxy 和瞬时 CPU/内存未证严格上限 | 仅接受为**带说明的资源边界**，不承诺无 OOM/卡顿；观察到实际可复现的资源耗尽须独立阻断并建立范围受控修复 |
| R3 | 结构化日志脱敏覆盖已知 Cookie、Token、Authorization 等模式；任意无标识自由文本不保证能识别私人题干和未知秘密 | 只允许最小诊断；禁止将私密题目、原始 URL、Cookie、Token 或用户浏览器配置上传到公共 CI/PR |
| R4 | \`clearErrorLogs\` 已有 FIFO 排队与竞态回归，错误日志持久化与内存集合不是永远相同；面向用户的清理入口及异常路径在此次评估中**没有完整真实浏览器人工验收** | 如产品拟宣传“可随时清除全部诊断数据”，必须先补实机验证与可观察结果；不可假定 UI 删除即清掉所有数据源 |
| R5 | 真实登录态学习网站的填答行为没有独立现场授权验收 | **广泛实际学习网站兼容性声明 BLOCKED**；使用合法授权会话按 Phase 13B 只读规则验收，后续填答需要额外明确授权与独立安全门禁；不得绕过认证 |
| R6 | 无已核验的商店上架、用户安装/升级、生产服务配置与回滚实际演练记录 | **公开发布 BLOCKED**；必须通过单独的人工发布审批和上线/回滚检查 |

旧 [PR #85](https://github.com/ljjnb666-nb/AI-Question-Analysis-Assistant-Browser-Extension/pull/85) 仍为 Draft / OPEN / UNMERGED 历史实验；不得把它计入 main，也不得直接合并来宣称修复了 R1。

## 4. 冻结与发布分阶段判定

1. **技术候选证据就绪（PASS）**：本评估所引用的 \`52d0b899...\` 已通过准确 main CI、RC、真实公共页只读验收；其 7 类产物可检索。
2. **冻结决策记录准备（IN REVIEW）**：本文所在 PR 仍须准确 HEAD 双流水线、独立 Review、明确合并授权、Merge Commit 双 Parent，以及**文档合并后**准确 main SHA 9/9 + RC 6/6 验收；在那之前不称“新主干已冻结”。
3. **限定范围内部候选（ELIGIBLE AFTER GATES）**：仅可向授权测试人员明确演示已证实的构建/公开页只读识题能力；所有限制必须同时展示，不等同公开发布许可。
4. **对外公开发布（NOT APPROVED）**：先独立确认 Chrome Web Store/分发合规、权限说明、隐私与凭据告知、服务生产配置、真实手动安装/升级、用户清理路径、监控告警、制品保留与回滚演练；用户另行明确授权正式发布/标签/部署/推广。
5. **广泛真实站点自动填答（NOT VALIDATED）**：不能用只读验收或离线填答语料替代合法、用户授权的真实会话测试。任何自动提交始终禁止。

## 5. 冻结后变更、失败与回滚

- 候选冻结后默认不修改运行时代码；发现 P0/P1 或会导致错误填写、越权、泄露用户敏感内容的可复现缺陷时，**立即中止发布**，另开受控修复 PR、回归测试，并重新形成准确 SHA 的全套 RC 证据。
- CI 失败不能由其他事件同 SHA 的 PASS 覆盖失败 Run；如 R1 复发，应保留原始 Run/脱敏网络证据，并继续关联 Issue #83。
- 有限候选的撤回操作必须有预案：停止分发当前制品、恢复此前已核验的已知良好版本/配置、评估持久化与凭据兼容性，按权限与用户告知要求执行；**未演练不得宣称回滚已验证**。
- 任何新的 Git Commit、依赖变更、RC 构建镜像或版本号变更都创建新候选身份；原主干 9/9 成功记录不能作为新候选的最终验收依据。
- 在没有用户对**具体 PR 或正式发布动作**的明确授权时，允许准备证据与 Draft PR，但不擅自合并、创建版本标签、部署或上架。
