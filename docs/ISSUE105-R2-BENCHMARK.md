# Issue #105 · R2A 截图选择题离线质量 Benchmark

**状态：基建与合成回归切片；真实截图评测 NOT RUN，Windows Microsoft Edge 验收 NOT RUN。**

## 目标与边界

R1 将视觉模型文本里显式 A/B/C/D 持久化为 display-only `ParseResult.structuredChoice`。R2A **只提供脱敏 Ground Truth 数据契约、截图 SHA256 绑定和离线指标/失败样例归因**，不修改线上识别、选择题答案、Fill、自动提交、扩展权限或置信度门槛。

**不要**把 `vision_text_labels_unverified` 理解为真实截图中的选项经人工验证。真实照片必须由人逐像素核对，工具验证的是文件 SHA256 与人工标注的关联，不能自动证明标注正确。正式评测还需要截图获取过程、版本、取样方式和人工复核记录。合成测试不能给产品提供真实准确率。

## 运行

Node.js 24+，从仓库根目录执行：

```bash
npm run test:issue105:benchmark
node tools/issue105/runBenchmark.mjs benchmarks/issue105/synthetic-fixtures.json
node tools/issue105/runBenchmark.mjs /path/to/private/dataset.json --output /path/to/private/report.json
```

- **无真实样本**：返回 `status=NO_REAL_SAMPLES`，真实 cohort 的所有率值为 `null`，不得误写成 0% 或 100%。
- **有真实样本**：报告 `REAL_METRICS_NOT_EDGE_ACCEPTANCE`，仍不代表 Edge 实机或生产质量达标。
- **失败样本**：逐个输出 caseId、站点别名和失败代码，不直接输出截图、题目原文或答案。评价出现失败案例 CLI 退出码 1；数据、路径、哈希无效退出码 2；全过退出码 0，但只代表输入样本的这次检查。
- 报告输出文件使用排他创建，禁止覆盖先前报告；记录原始数据集 hash/版本可在后续数据治理切片补充。

## 数据集格式（版本 `issue105-r2a-v1`）

`datasetId`、`caseId`、`siteId` 使用不泄露账号/URL 的稳定匿名别名。每个 `caseId` 全数据集唯一。`samples` 不能超过 10000。参考 `benchmarks/issue105/synthetic-fixtures.json`。

每个样本：

- `evidence` 必须选择 **`{kind:"synthetic_fixture",fixtureId:"..."}`** 或真实 **`{kind:"real_edge_screenshot",relativePath:"screenshots/xxx.png",sha256:"<64位小写十六进制>",annotation:{method:"human_pixel_review",reviewerAlias:"anon-1",reviewedAt:"2026-10-13T00:00:00Z"}}`**。真实截图相对路径限定在 dataset.json 所在目录中（含符号链接真实路径检查），实际文件必须是 PNG/JPEG 签名且 SHA256 与数据集一致；没有可读取文件不纳入指标。
- `truth` 选择 `{status:"readable",stem:"...",options:[{key:"A",text:"..."},...D]}`，或 `{status:"unreadable",reason:"missing_labels"|"occluded"|"ambiguous"|"unreadable_text"}`。readable 必须是原图人工可核对、A/B/C/D 正序四个非空选项。对于真实图片上选项缺损或顺序不能可靠映射的情况，标记 unreadable，不能补出假标签。
- `observation` 字段：`blockId`、`resultBlockId`、`blockSource`、`routeUsed`、`questionType`、`structuredChoice`（DTO 或显式 `null`）；可选 `history:{structuredChoice:<原样持久化的DTO或null>}`。只复用生产 `readManualChoiceStructureForDisplay` 的校验结果来计算显示结构，不从 `answer`、`optionSelections`、裸 OCR 词串或 `recognizedText` 重新猜选项；这一切片是**输出结构质量评测**，非识别路径的完整 Recall。
- 上传模型/扩展观测前去除 API Key、Cookie、登录标识、姓名和受保护试题；只有公开或有权使用的图片可以进入人工审核集。不把用户真实图片提交到仓库或公开 CI。建议私有样本放 `benchmarks/issue105/private/`（Git 忽略），如需公开样本应先审核授权与脱敏。

## 分母 / 指标和失败归因

**真实与合成样本始终分开统计，绝不混成总体准确率。**

| 指标 | 分子 | 分母 |
| --- | --- | --- |
| `strictWholeQuestionRecall` | 题干和全部 4 组标签-文本都严格匹配的样本数 | 可人工确认的 readable 样本 |
| `strictWholeQuestionPrecision` | 上述整题完全匹配数 | 实际展示合法结构的全部样本（含不可读时误生成） |
| `stemExactRate` | 展示题干严格匹配的样本数 | readable 样本 |
| `optionPairExactRate` | 标签及正文均匹配的选项对数 | readable 样本 × 4 |
| `correctRejectRate` | unreadable 且没有合法结构输出的样本数 | unreadable 样本 |
| `historyConsistencyRate` | 有 history 观测且经校验的历史结构与候选结构完全一致的样本数 | 实际提供 history 观测的样本数 |

严格匹配仅允许首尾空格和 CRLF/LF 差异；不能通过模糊相似度掩盖错字或标签错误。任何分母为 0 的比率必须返回 `null`。失败码包括 `MISSING_STRUCTURE`、`STEM_MISMATCH`、`OPTION_PAIR_MISMATCH_A..D`、`FALSE_STRUCTURE_ON_UNREADABLE_PIXELS`、`HISTORY_DTO_MISMATCH`、`INVALID_OR_UNAUTHORIZED_DTO`。附带站点分布、可读/不可读分类、缺失与错误 DTO 计数。

## 后续真实验收门（尚未达成）

需要人工建立真实 Edge 截图语料及正确标签、验证原始图像的授权/完整性，覆盖题干换行、选项换行、图文混排、遮挡、公式、漏字与模型幻觉，并记录人工双重复核意见。未来规模目标约 10 站点、500–1000 道题，**当前真实样本数为 0**。在此之前不得从上述 synthetic 夹具推断生产环境识别成熟度，也不关闭 Issue #105。
