# HTTP API

Koma 的分析任务是异步的。提交视频后轮询任务，完成后既可以读取完整视频理解结果，也可以只取自定义提取出的 JSON。

## 用 AI 整理 JSON 结构

提交视频前，可以让已配置的视觉 Provider 把自然语言要求整理成可编辑的 JSON 示例：

```bash
curl -X POST http://localhost:3000/api/analysis-spec/generate \
  -H 'content-type: application/json' \
  -d '{
    "instruction": "提取所有商品、价格和首次出现时间",
    "lang": "zh"
  }'
```

这个请求不会创建任务，也不会分析视频。返回的 `outputSchema` 一定是对象或数组，可以先检查、编辑，再提交给 `/api/analyze/url` 或 `/api/analyze/upload`：

```json
{
  "outputSchema": {
    "products": [
      { "name": "string", "price": 0, "atMs": 0 }
    ]
  }
}
```

`instruction` 必填，最长 4000 字符；`lang` 可省略，仅支持 `en` 或 `zh`。请求体上限为 16 KiB，成功响应包含 `cache-control: no-store`。

只有配置了真实视觉 Provider 及其凭据时，这个接口才可用。它与视频分析共用演示额度，无效请求会在消耗额度前被拒绝。无效输入返回 `400`，请求体过大返回 `413`，演示额度耗尽返回 `429`，Provider 调用失败或返回无效 JSON 结构返回 `502`，视觉 Provider 不可用或未配置返回 `503`。

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
