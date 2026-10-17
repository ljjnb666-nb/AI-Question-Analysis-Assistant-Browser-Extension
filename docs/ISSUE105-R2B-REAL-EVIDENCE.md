# Issue #105 · R2B 真实截图采集与双人标注门禁

**状态：R2B 工具与契约回归切片，不是 Edge 实机验收。真实截图数据集仍为 0。**
延续 [R2A Benchmark 说明](./ISSUE105-R2-BENCHMARK.md)；所有真实样本只能用于用户授权且脱敏的本地目录，不得提交到 GitHub 仓库。

## 执行流程（Windows Edge / 本地）

1. 在 Windows Edge 真实安装并记录 **与构建制品匹配** 的扩展 Commit SHA 和制品 SHA256。不得把 CI Chromium 测试或注释声称是 Edge 实机运行的证据。
2. 在有合法使用权的公开题目或模拟站点使用**手动截图识别**。先删除姓名、Cookie、验证码、账号、API Key、未授权的题目内容，保存原始 PNG/JPEG 到 `benchmarks/issue105/private/screenshots/`。保留首次失败和未识别的例子，不只选成功样本。
3. 一题一个匿名 `caseId`，使用 R2A 格式的 `dataset.json`。真实题目新增 `capture`：必须精确记录 `client`、`captureMethod`、`sourcePolicy`、`siteId`、`sessionAlias`、`capturedAt`、`extensionCommit` 和 `extensionArtifactSha256`；截图的 `evidence.sha256` 是文件字节摘要，不代表截图中的字符得到验证。
4. **两位不同的人工复核者**分别查看与 `evidence.sha256` 一致的原始截图，独立提交整道题的 `truth`（题干与完整 A/B/C/D，或明确无法可靠读取的原因），不得先看插件解析结果和另一位的标注，不能从答案字母反推视觉选项。各自的条目写入私有 `reviews.json`。
5. 先计算对 `dataset.json` **原始文件字节**的 SHA256 填入 `reviews.datasetSha256`，其版本是 `issue105-r2b-review-v1`。每道真实题必须**恰好两条**属于同一题与图像 SHA256、不同 `reviewerAlias` 的审核记录；两人不一致、与最终 Ground Truth 不一致、复核时间早于截图时间均拒绝计算，人工解决冲突后重新独立复核。
6. 执行下方命令，保存本地报告和必要失败图像供复核。不要上传明文图片、私人标注或含真实试题的报告。保留环境版本、请求代际、运行失败、样本取样方式与脱敏记录。

```powershell
# PowerShell 示例；从仓库根目录执行；路径内数据全部保持私有
$root = "benchmarks/issue105/private"
Get-FileHash "$root/dataset.json" -Algorithm SHA256

npm run test:issue105:benchmark
node tools/issue105/runBenchmark.mjs "$root/dataset.json" --reviews "$root/reviews.json" --output "$root/report.json"
```

### R2B 复核侧车文件示例（不含真实题目）

```json
{
  "version": "issue105-r2b-review-v1",
  "datasetId": "edge-corpus-01",
  "datasetSha256": "<dataset.json 的 64 位小写 SHA256>",
  "entries": [
    {
      "caseId": "sample-01",
      "imageSha256": "<对应 PNG/JPEG 文件的 64 位小写 SHA256>",
      "reviewerAlias": "reviewer-a",
      "method": "independent_pixel_annotation",
      "reviewedAt": "2026-10-13T10:30:00Z",
      "truth": { "status": "unreadable", "reason": "occluded" }
    },
    {
      "caseId": "sample-01",
      "imageSha256": "<同一文件的 SHA256>",
      "reviewerAlias": "reviewer-b",
      "method": "independent_pixel_annotation",
      "reviewedAt": "2026-10-13T10:40:00Z",
      "truth": { "status": "unreadable", "reason": "occluded" }
    }
  ]
}
```

对应 `dataset.samples[0]` 的 `capture` 示例：

```json
{
  "client": "microsoft_edge",
  "captureMethod": "manual_capture",
  "sourcePolicy": "public_or_authorized",
  "siteId": "public-site-a",
  "sessionAlias": "edge-session-01",
  "capturedAt": "2026-10-13T10:20:00Z",
  "extensionCommit": "<40 位完整 Git Commit SHA>",
  "extensionArtifactSha256": "<64 位制品 SHA256>"
}
```

注意：本模块仅对记录格式、两份标注、图像/数据摘要及一致性进行**静态检查**，无法证明这两人真的独立、采集是否真的发生在 Windows Edge、图片来源是否授权，或截图中文字与人工标注是否正确。**不能把自报一致性当做加密签名或实机证据**。

## 退出状态 / 准入

- 缺少复核记录、哈希篡改、伪造来源字段、两名复核者分歧：CLI **退出码 2**，在计算实际结构准确率**之前**拒绝本次数据集。合成夹具正常运行。
- 复核一致而插件识别失败：CLI **退出码 1**，可生成包含明确 `FAIL` 样本原因的报告。失败样本必须留存，禁止筛选掉以冲高准确率。
- 没有失败、全部复核格式通过：CLI **退出码 0**；只表示这一次样本的规则与对照通过，**不是**上线合格、全面准确或 Windows Edge 验收通过。
- 报告 `reviewAudit.state=TWO_REVIEWER_CONSENSUS_SELF_ATTESTED_NOT_EDGE_ACCEPTANCE` 明确保留未独立核验的性质。`status=REAL_METRICS_NOT_EDGE_ACCEPTANCE` 不变。
- 报告输出使用独占创建，不能覆盖历史报告；勿将其上传到 CI。合成夹具报告依然 `NO_REAL_SAMPLES`，真实率为 null。

## 待完成的真实验收门

R2B 不引入任何真实截图或敏感数据，也不修改插件运行时/Fill/Submit。正式质量验收至少需要带采集证据且由实际人员审核的真实数据集（覆盖多站点、可读/不可读、连续多行、选项前缀缺失、公式、图文混排、截断及遮挡）、独立核实人工标注、报告失败图片清单、再在**用户 Windows Edge**完成实机回归。截图实际图像解码质量和来源可信仍需单独闭环，CI 模拟不能替代。Issue #105 保持 OPEN。
