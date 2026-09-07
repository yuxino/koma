# HTTP API

Koma 的分析任务是异步的。提交视频后轮询任务，完成后既可以读取完整视频理解结果，也可以只取自定义提取出的 JSON。

## 身份验证

网页分析、AI JSON 生成和个人历史都需要 GitHub 登录。GitHub 身份与管理员权限相互独立，登录其中一种不会得到另一种权限。

| 方法 | 地址 | 用途 |
| --- | --- | --- |
| `GET` | `/api/auth/session` | 返回 `{ enabled, authenticated, user, legacyJobCount }`；未登录时 `user` 为 null |
| `GET` | `/api/auth/github?returnTo=/` | 在浏览器中发起已配置 GitHub App 的授权流程 |
| `GET` | `/api/auth/github/callback` | 校验 GitHub 回调并建立 Koma 账号会话 |
| `DELETE` | `/api/auth/session` | 撤销当前账号会话、清除 Cookie，返回 `204`；需要 `X-Koma-Client: 1` |

已登录的 `user` 包含 `{ id, login, name, avatarUrl }`；`id` 是以字符串表示的稳定 GitHub 数字 ID，`name` 可以为 null。未登录时 `legacyJobCount` 为零；登录后则表示当前旧浏览器 Cookie 下尚未认领的任务数量。会话响应使用 `cache-control: no-store`。

`koma_session` Cookie 为 HttpOnly、SameSite=Lax，作用路径为 `/`，HTTPS 下带 Secure。会话在建立七天后到期，不会随访问延长；数据库只保存令牌哈希。退出会撤销当前浏览器的账号会话，不会退出其他设备或独立的管理员会话。重新授权会替换当前 Koma 会话。GitHub 令牌只用于获取公开用户资料，不会持久化或返回浏览器。

OAuth 尝试有效期为十分钟，使用一次性 state、独立的 `koma_oauth` 浏览器 Cookie 和 PKCE S256。`returnTo` 只接受站内路径，拒绝外部来源、双斜杠地址和 API 路径。取消授权、回调过期/无效、Provider 或配置异常时，分别返回 `/?auth=cancelled`、`/?auth=expired` 或 `/?auth=unavailable`。

单台服务按 IP 限制每个 UTC 日最多发起 100 次登录；超过后返回 `429` 和 `Retry-After`，不会再创建待处理的 OAuth 尝试。这个限制独立于分析演示额度。

## 分析权限

`POST /api/analysis-spec/generate`、`POST /api/analyze/url`、`POST /api/analyze/upload` 和 `POST /api/my/jobs/:id/retry` 都需要有效的 GitHub 账号会话和 `X-Koma-Client: 1` 请求头。其他账号写操作使用同一请求头，同时兼容旧的 `x-koma-user: 1`。Fetch Metadata 表示跨站，或请求携带的 Origin 与配置的回调来源不一致时，会拒绝请求。

请求头缺失或错误返回 `403`；通过该校验后，没有账号会话返回 `401`。同时配置 `ADMIN_PASSWORD` 与 `ANALYSIS_REQUIRE_ADMIN=true` 时，还必须携带有效的 `koma_admin` 会话，否则返回 `403`。只有管理员会话不能提交网页任务。后台写操作仍使用独立的 `x-koma-admin: 1` 请求头。

Koma 界面会自动发送 Cookie 和请求头。下方 curl 示例假设 `cookies.txt` 已包含通过浏览器授权获得的有效 Koma 账号会话；此 API 不提供密码、PAT 或机器令牌登录。管理员限定模式还需要同一 Cookie Jar 中的管理员会话。无需网页登录的本地文件分析可使用[本地 CLI](../README.zh-CN.md#cli)。

## 用 AI 整理 JSON 结构

提交视频前，可以让已配置的视觉 Provider 把自然语言要求整理成可编辑的 JSON 示例：

```bash
curl -X POST http://localhost:3000/api/analysis-spec/generate \
  -b cookies.txt -H 'X-Koma-Client: 1' \
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

无效输入返回 `400`，缺少账号会话返回 `401`，请求校验或可选管理员要求未通过返回 `403`，请求体过大返回 `413`，演示额度耗尽返回 `429`，Provider 请求失败或修复结果仍无效返回 `502`，视觉 Provider 不可用或未配置返回 `503`。

## 视频地址

```bash
curl -X POST http://localhost:3000/api/analyze/url \
  -b cookies.txt -H 'X-Koma-Client: 1' \
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

返回 `202`。这个 ID 同时组成私有回看地址 `/jobs/JOB_ID`：

```json
{ "jobId": "..." }
```

视频地址提交需要 GitHub 登录。Koma 尚未完整阻止重定向或解析到私有、链路本地地址的域名。身份验证只能限制调用者，不能充当出站网络隔离；允许不可信用户使用的部署仍应配置出站策略或可信 URL 白名单。

## 本地上传

multipart 中的文本字段必须放在 `video` 文件字段之前：

```bash
curl -X POST 'http://localhost:3000/api/analyze/upload?lang=zh' \
  -b cookies.txt -H 'X-Koma-Client: 1' \
  -F 'instruction=提取所有商品、价格和首次出现时间' \
  -F 'outputSchema={"products":[{"name":"string","price":0,"atMs":0}]}' \
  -F 'artifactFormats=["json","csv"]' \
  -F 'video=@demo.mp4'
```

`instruction` 最长 4000 字符；`outputSchema` 可以是 JSON 示例或 JSON Schema，最长 12000 字符。`artifactFormats` 支持 `json`、`csv`、`markdown`、`srt` 和 `text`。它们都可省略，此时运行默认通用总结。输出语言直接写在 `instruction` 中，例如“生成中文、英文、日文三份 SRT 字幕”。

## 读取结果

账号任务的每个任务、提取 JSON、产物、视频和关键帧接口都会校验所有者或管理员会话。未登录或其他账号访问时返回 `404`，与任务不存在时一致。尚未认领的旧链接保留只读访问。任务响应包含 `owned`、`visibility`（`private` 或 `legacy-link`）和 `retryable`。

```bash
curl -b cookies.txt http://localhost:3000/api/jobs/JOB_ID
```

任务完成后，完整响应的 `result.extractedData` 是按要求提取的数据。若只需要目标 JSON，不要 Koma 的标题、章节等外层结构：

```bash
curl -b cookies.txt http://localhost:3000/api/jobs/JOB_ID/extraction
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

携带有权限的会话访问 `downloadUrl`，即可下载持久化文件；视频和关键帧使用相同权限校验。OSS 响应会跳转到短期签名地址；拿到该地址的人在到期前仍可使用它。当前只生成文本类产物，不接受模型返回的 base64 或二进制文件。

浏览器还可直接从已保存的结果导出 Markdown 笔记和 SRT 字幕，无需再次调用模型；这与模型生成的 `result.artifacts` 是两种独立的导出方式。

## 我的任务

个人历史跟随 GitHub 账号，在不同浏览器登录后都可恢复。以下接口均需要有效账号会话；写操作还需要 `X-Koma-Client: 1`。

| 方法 | 地址 | 用途 |
| --- | --- | --- |
| `GET` | `/api/my/jobs` | 读取账号最近 200 个任务，包含摘要、时长、状态和 `retryable` |
| `GET` | `/api/my/jobs/legacy` | 列出当前已有 `koma_viewer` Cookie 能证明归属、尚未认领的任务 |
| `POST` | `/api/my/jobs/claim` | 明确把这些浏览器任务转入当前账号；返回 `{ claimed }` |
| `POST` | `/api/my/jobs/:id/retry` | 从可恢复的失败任务创建新的账号任务；返回 `202` 和 `{ jobId }` |
| `DELETE` | `/api/my/jobs/:id` | 永久删除当前账号拥有的任务；返回 `204` |

认领新增账号归属，并限制之后的回看和源站对象访问，但不能收回此前下载的文件或缓存的公开响应。它不会取得其他浏览器的任务，也不会覆盖已有账号归属。没有有效的旧 Cookie 时，列表为空、认领数为零；清除 Cookie 后不能靠任务 ID 恢复证明。如果对象私有权限设置失败，认领可返回 `503`，并且不会把任务分配给账号。

只有失败且保留来源 URL 或视频文件的任务可以重试。重试复制原语言和分析要求，使用当前配置的 Provider，并保留原失败记录；有保存的视频时优先使用，不重新下载 URL。任务正在执行或已完成、来源缺失、保留视频无法读取时返回 `409`；其他账号的任务返回 `404`。重试同样受分析权限和单 IP 演示额度限制；保存的 URL 仍可能在新分析中因过期或站点问题而失败。

`DELETE /api/jobs/:id` 返回 `405`，应使用账号或后台删除接口。删除会移除持久化记录和整个任务存储目录。当前没有把新账号任务改为公开的 API。

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
