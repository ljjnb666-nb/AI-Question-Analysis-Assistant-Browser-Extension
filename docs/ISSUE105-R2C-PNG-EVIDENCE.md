# Issue #105 · R2C Windows Edge 截图文件预检与像素完整性

**阶段性质：离线证据完整性防线，不是已完成的 Edge 实机测试。2026-10-13 未取得任何已授权、可人工复核的真实 Windows Edge 截图，实际识别准确率仍不可测量。**

## 已闭合的具体漏洞

R2A/R2B 只根据 PNG/JPEG 文件头和 SHA256 判断截图文件存在：一个人工构造的伪 PNG（8 字节签名后面接任意文本）也会通过。R2C 对 **PNG** 验证：PNG 文件头，完整 IHDR/IDAT/IEND 顺序、全部 chunk CRC32、禁止尾随脏数据、静态 PNG 属性、非交错 8-bit 色彩模式、尺寸与解压上限、真实 DEFLATE 解压长度、逐行滤波/像素重建。超大、截断、压缩炸弹、坏数据块和 APNG 拒绝处理，整个样本不能进入质量统计。

**此次严格模式只支持 PNG：JPEG 缺少可靠像素解码器，所以暂时拒绝 JPEG 进入评测。** 不应将 JPEG 的开头字节视为实际可解码证据。如果确有原始 JPEG，请保存原始文件与哈希并由具备图像能力的受信工具另行转为 PNG、记录转换方法和新哈希，再审核。不能只改文件扩展名。

PNG 文件可以被完整解压并还原字节，仍然 **不代表图片所示文字、A/B/C/D 标签或截图实际来源已被独立证实**；人工标注和 Edge 上的实际抓取还要单独完成。

## 用户本机执行

1. 安装与记录需要验收的 Edge 插件构建；复制仓库代码到本地（或先在已安装项目根目录执行）。将实际 Edge 手动截图识别的图片保存在 **`benchmarks/issue105/private/screenshots/`**。该目录已 Git 忽略，必须事先遵守站点使用许可并清理私人信息；切勿将它们提交到公开仓库。
2. 使用 PowerShell 从仓库根目录预检每张 **真实 PNG**：

```powershell
node tools/issue105/verifyScreenshot.mjs "benchmarks/issue105/private/screenshots/edge-01.png"
```

仅输出 `width`、`height`、`sha256` 和 `PNG_PIXELS_CHECKED_NOT_EDGE_ACCEPTANCE` 状态，不输出截图像素、用户信息或题目正文。保存 SHA256 到数据集 `evidence.sha256`，`relativePath` 相对私有 `dataset.json` 所在目录。

3. 按 [R2B 双人标注操作说明](./ISSUE105-R2B-REAL-EVIDENCE.md) 准备同一快照的 `dataset.json` 与 `reviews.json`；每道题都要求人工真值完整、不同审核人分别标注、原始图片哈希匹配、审核一致且保留所有失败。
4. 运行离线 Benchmark：

```powershell
npm run test:issue105:benchmark
node tools/issue105/runBenchmark.mjs "benchmarks/issue105/private/dataset.json" --reviews "benchmarks/issue105/private/reviews.json" --output "benchmarks/issue105/private/report.json"
```

如果 JSON、截图、哈希、解压或审核不合法，命令以退出码 2 失败，并且不发布部分计算结果；识别有实质错题会以退出码 1 输出失败记录。运行结束成功且含真实样本，也只产生 `REAL_METRICS_NOT_EDGE_ACCEPTANCE` 的自报审核结果，不能据此关闭 #105。

## 不可绕过的边界和后续验收

- 禁止用合成/伪造 PNG 或本项目契约测试夹具充当真实 Edge 图片。CI 上的 Chromium 自动化和 Python/Pillow 自制的小图片也只属于**程序测试**。
- 必须保存 Edge 版本、插件 Commit 和构建制品、截图时间、站点匿名别名、题型、候选/历史的同一块 ID 和实际截屏、失败输入，截图必须有合法采集权限。
- PNG 解码完整性解决的是**字节证据有效性**，不是站点真值可信性、独立标注身份验证、视觉模型泛化或自动填写权威。
- 真正关闭 Issue #105 需要在用户 Windows Edge 的真实截图集上，覆盖长题干、A-D 选项跨行、无标签、公式、图片和遮挡，核算严格整题识别 Recall/Precision 和误识别/正确拒绝，并核查候选与历史结构、置信度误导、候选答案与自动填写限制。

**阶段状态：代码侧图片预检就绪后才能进行人工采集；真实 Edge 验收仍待执行，真实样本数 0。**
