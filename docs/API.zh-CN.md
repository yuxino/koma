# HTTP API

Koma 的分析任务是异步的。提交视频后轮询任务，完成后既可以读取完整视频理解结果，也可以只取自定义提取出的 JSON。

## 分析权限

AI JSON 生成和视频地址/文件分析默认对游客开放，即使 `ADMIN_PASSWORD` 已启用 `/admin` 也不会改变。只有同时配置 `ADMIN_PASSWORD` 与 `ANALYSIS_REQUIRE_ADMIN=true` 后，`POST /api/analysis-spec/generate`、`POST /api/analyze/url` 和 `POST /api/analyze/upload` 才要求携带由 `POST /api/admin/login` 建立的 `koma_admin` 管理员会话，以及同源请求头 `x-koma-admin: 1`。请求头正确但未登录时返回 `401`；请求头缺失或错误时返回 `403`。管理员登录后，Koma 浏览器界面会自动发送 HttpOnly Cookie 和该请求头；API 客户端需要自行保存 Cookie 并补上请求头。

只读任务和回看接口在两种模式下都不变。

下方提交示例默认使用公开模式。受保护模式应先登录一次并保存 Cookie：

```bash
curl -X POST http://localhost:3000/api/admin/login \
  -H 'content-type: application/json' \
  -H 'x-koma-admin: 1' \
  -c cookies.txt \
  -d '{"password":"YOUR_ADMIN_PASSWORD"}'
```

随后给三个受保护请求都加上 `-b cookies.txt -H 'x-koma-admin: 1'`。

## 用 AI 整理 JSON 结构

提交视频前，可以让已配置的视觉 Provider 把自然语言要求整理成可编辑的 JSON 示例：

```bash
curl -X POST http://localhost:3000/api/analysis-spec/generate \
  -H 'content-type: application/json' \
  -d '{
    "instruction": "识别车牌，输出城市和省份",
    "additions": ["附上判断依据和首次出现时间"],
    "lang": "zh"
  }'
```

这个请求不会创建任务，也不会分析视频。返回的 `outputSchema` 一定是对象或数组，可以先检查、编辑，再提交给 `/api/analyze/url` 或 `/api/analyze/upload`。`fieldDescriptions` 会用指定语言解释每个叶子字段，并标明它来自用户原始要求还是快速补充：

```json
{
  "outputSchema": {
    "plates": [
      { "plateNumber": "string", "city": "string", "province": "string", "evidence": "string", "atMs": 0 }
    ]
  },
  "fieldDescriptions": [
    { "path": "plates[].plateNumber", "label": "车牌号码", "description": "视频中识别到的完整车牌号码", "source": "request" },
    { "path": "plates[].city", "label": "所属城市", "description": "根据已识别车牌推断的城市", "source": "request" },
    { "path": "plates[].province", "label": "所属省份", "description": "根据已识别车牌推断的省份", "source": "request" },
    { "path": "plates[].evidence", "label": "判断依据", "description": "支持本次识别结果的画面证据", "source": "addition" },
    { "path": "plates[].atMs", "label": "首次出现时间", "description": "车牌首次出现的时间，单位为毫秒", "source": "addition" }
  ]
}
```

`instruction` 或 `additions` 至少要有一项非空内容，合计最长 4000 字符；`additions` 最多接受 8 个字符串。每个 JSON 叶子字段必须有且仅有一条同路径说明，不接受缺失、重复或多余路径。`lang` 可省略，仅支持 `en` 或 `zh`。请求体上限为 16 KiB，成功响应包含 `cache-control: no-store`。

只有配置了真实视觉 Provider 及其凭据时，这个接口才可用。它与视频分析共用演示额度，无效请求会在消耗额度前被拒绝。模型第一次返回的内容若无法解析，或未通过 JSON 结构/路径校验，Koma 会用更严格的要求自动请求一次完整修复结果；修复后仍无效才返回 `502`，Provider 请求失败则不重试。

无效输入返回 `400`，受保护模式下缺少管理员会话返回 `401`、缺少请求头返回 `403`，请求体过大返回 `413`，演示额度耗尽返回 `429`，Provider 请求失败或修复结果仍无效返回 `502`，视觉 Provider 不可用或未配置返回 `503`。

## 视频地址

```bash
curl -X POST http://localhost:3000/api/analyze/url \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://example.com/video.mp4",
    "lang": "zh",
    "instruction": "提取所有商品、价格和首次出现时间",
    "outputSchema": {
      "products": [
        { "name": "string", "price": 0, "atMs": 0 }
      ]
    },
    "artifactFormats": ["json", "csv"]
  }'
```

返回 `202`。这个 ID 同时组成永久、不可猜的回看地址 `/jobs/JOB_ID`：

```json
{ "jobId": "..." }
```

未设置 `ANALYSIS_REQUIRE_ADMIN=true` 时，视频地址提交接口对外公开。Koma 尚未完整阻止重定向或解析到私有、链路本地地址的域名。管理员登录只能限制调用者，不能充当出站网络隔离；公开部署仍应配置出站策略或可信 URL 白名单。

## 本地上传

multipart 中的文本字段必须放在 `video` 文件字段之前：

```bash
curl -X POST 'http://localhost:3000/api/analyze/upload?lang=zh' \
  -F 'instruction=提取所有商品、价格和首次出现时间' \
  -F 'outputSchema={"products":[{"name":"string","price":0,"atMs":0}]}' \
  -F 'artifactFormats=["json","csv"]' \
  -F 'video=@demo.mp4'
```

`instruction` 最长 4000 字符；`outputSchema` 可以是 JSON 示例或 JSON Schema，最长 12000 字符。`artifactFormats` 支持 `json`、`csv`、`markdown`、`srt` 和 `text`。它们都可省略，此时运行默认通用总结。输出语言直接写在 `instruction` 中，例如“生成中文、英文、日文三份 SRT 字幕”。

## 读取结果

```bash
curl http://localhost:3000/api/jobs/JOB_ID
```

任务完成后，完整响应的 `result.extractedData` 是按要求提取的数据。若只需要目标 JSON，不要 Koma 的标题、章节等外层结构：

```bash
curl http://localhost:3000/api/jobs/JOB_ID/extraction
```

这个接口原样返回 `extractedData`。任务仍在执行时返回 `409`；没有请求自定义提取或任务已被删除时返回 `404`。

## 下载生成文件

任务响应中的 `result.artifacts` 只包含文件元数据和 `downloadUrl`，不会把大段文件内容嵌进轮询响应：

```json
{
  "name": "products.csv",
  "format": "csv",
  "mimeType": "text/csv; charset=utf-8",
  "sizeBytes": 281,
  "downloadUrl": "/api/jobs/JOB_ID/artifacts/0"
}
```

访问 `downloadUrl` 即可下载持久化文件；视频和关键帧也通过同一套只读任务 API 提供。当前只生成文本类产物，不接受模型返回的 base64 或二进制文件。

## 我的任务

浏览器首次提交任务或访问历史接口时会收到一年有效的 `koma_viewer` HttpOnly Cookie。Koma 只在数据库保存其哈希，并用它列出和删除该浏览器创建的任务：

| 方法 | 地址 | 用途 |
| --- | --- | --- |
| `GET` | `/api/my/jobs` | 读取当前浏览器最近 100 个任务的轻量历史 |
| `DELETE` | `/api/my/jobs/:id` | 永久删除当前浏览器创建的任务；同时需要 `x-koma-user: 1` 请求头 |

直接访问公开链接仍是只读操作。`DELETE /api/jobs/:id` 返回 `405`，仅有任务 ID 或分享链接不能删除任务。命令行客户端如果要保留归属，需要用 Cookie Jar（例如 curl 的 `-c cookies.txt -b cookies.txt`）。

## 管理 API

管理接口只供同源的 `/admin` 页面使用。配置 `ADMIN_PASSWORD` 后，先调用 `POST /api/admin/login` 建立 HttpOnly 会话；所有管理写请求还必须携带 `x-koma-admin: 1`，用于防止跨站请求伪造。

| 方法 | 地址 | 用途 |
| --- | --- | --- |
| `GET` | `/api/admin/session` | 检查后台是否启用以及当前登录状态 |
| `POST` | `/api/admin/login` | 管理员登录 |
| `DELETE` | `/api/admin/session` | 退出登录 |
| `GET` | `/api/admin/settings` | 读取脱敏 Provider 设置 |
| `PUT` | `/api/admin/settings` | 保存 Provider、模型、Base URL 和可选的新 Key |
| `POST` | `/api/admin/settings/reset` | 恢复服务器环境变量中的 Provider 配置 |
| `GET` | `/api/admin/jobs` | 读取最多 200 个永久任务 |
| `GET` | `/api/admin/jobs/:id` | 读取完整任务要求、Provider 快照和分析结果 |
| `DELETE` | `/api/admin/jobs/:id` | 停止任务并永久删除数据库记录及整个存储目录 |

设置接口永远不会返回 API Key 明文；只会返回 `keyConfigured` 和类似 `••••1234` 的 `keyHint`。
