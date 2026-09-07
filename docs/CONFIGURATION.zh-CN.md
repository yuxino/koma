# 配置

复制 `.env.example` 为 `.env`。不配置模型凭证时，Koma 会返回演示分析数据；网页提交仍需要 [GitHub 登录](#github-登录)。

Koma 把 AI 分成两个独立阶段：

- `ASR_PROVIDER` 负责把声音转成带时间戳的字幕。
- `VISION_PROVIDER` 负责结合关键帧和字幕生成标题、总结、章节与标签。
- 用户填写自定义分析要求时，`VISION_PROVIDER` 还会按目标 JSON 结构生成 `extractedData`。

两者可以任意组合，不再绑定 Qwen。

默认 mock 模式可以演示总结、章节和时间线，但不会伪造结构化业务数据；按要求提取必须配置真实视觉模型。

AI 整理 JSON 结构通常只调用一次视觉 Provider。若结果无法解析，或未通过结构/路径校验，Koma 会再发起一次要求更严格的修复请求，然后才返回无效输出错误。

## GitHub 登录

网页分析需要 GitHub 账号，AI Provider 使用演示数据时也一样。本地 CLI 独立运行，不要求网页登录。

为自己的部署注册一个 **GitHub App**，填写用户授权回调地址。仓库、组织和账号权限都不申请，并关闭 Webhook；Koma 只读取用于登录的公开用户资料。这个登录流程不需要安装到仓库，不需要 App 私钥，也不需要另建 OAuth App。可参考 GitHub 的[注册说明](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app)和[权限模型](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | 空 | GitHub App 的 Client ID，不是数字 App ID |
| `GITHUB_CLIENT_SECRET` | 空 | GitHub App 的 Client Secret，只能放在服务端 |
| `GITHUB_CALLBACK_URL` | 空 | 与注册项完全一致、以 `/api/auth/github/callback` 结尾的回调地址 |

本地使用 `npm run dev` 时，注册并设置 `http://localhost:5173/api/auth/github/callback`，从 `http://localhost:5173` 打开应用。Vite 会把 `/api` 转发给后端。登录前后应保持主机名一致，`localhost` 和 `127.0.0.1` 不共享 Cookie。线上使用自己的 HTTPS 域名，例如 `https://koma.yuxino.cn/api/auth/github/callback`。回调地址不能包含用户名密码、查询参数或片段；普通 HTTP 只允许用于本机开发。

使用仓库的 GitHub Actions 部署时，Secret 名称应为 `KOMA_GITHUB_CLIENT_ID`、`KOMA_GITHUB_CLIENT_SECRET` 和 `KOMA_GITHUB_CALLBACK_URL`；工作流会映射为上方的运行时变量。GitHub Actions 保留了以 `GITHUB_` 开头的 Secret 名称。详见[部署说明](../DEPLOY.md)。

Client Secret 只能保存在受保护的服务器环境或部署 Secret 中，不能放入浏览器配置或 `VITE_*` 变量。GitHub 配置缺失或无效时，无法发起新的登录，也不会退回匿名网页分析。真实视频分析仍需另外配置 Provider。

Koma 使用一次性、绑定发起浏览器的 OAuth state 和 PKCE S256。自身的 HttpOnly 会话有效期为七天；GitHub 访问令牌只用于获取用户资料，不会保存。会话与退出行为见[身份验证 API](API.zh-CN.md#身份验证)。

## Provider 预设

| 阶段 | Provider | 默认模型 | Key |
| --- | --- | --- | --- |
| ASR | `dashscope` | `fun-asr-flash-2026-06-15` | `DASHSCOPE_API_KEY` |
| ASR | `groq` | `whisper-large-v3-turbo` | `GROQ_API_KEY` |
| ASR | `openai` | `whisper-1` | `OPENAI_API_KEY` |
| ASR | `openai-compatible` | 自定义 | `ASR_API_KEY` |
| 视觉 | `dashscope` | `qwen3-vl-flash` | `DASHSCOPE_API_KEY` |
| 视觉 | `openai` | `gpt-4.1-mini` | `OPENAI_API_KEY` |
| 视觉 | `gemini` | `gemini-2.5-flash` | `GEMINI_API_KEY` |
| 视觉 | `openrouter` | `openrouter/free` | `OPENROUTER_API_KEY` |
| 视觉 | `groq` | `meta-llama/llama-4-scout-17b-16e-instruct` | `GROQ_API_KEY` |
| 视觉 | `openai-compatible` | 自定义 | `VISION_API_KEY` |

所有预设都能通过 `ASR_MODEL`、`VISION_MODEL`、`ASR_BASE_URL` 和 `VISION_BASE_URL` 覆盖。模型下线或厂商改名时不需要改代码。

## 免费额度演示

仓库提供了 `.env.demo.example`：

```bash
cp .env.demo.example .env
```

然后在服务器端填写：

```dotenv
GROQ_API_KEY=...
OPENROUTER_API_KEY=...
```

这个组合使用：

- [Groq Speech to Text](https://console.groq.com/docs/speech-to-text)：Whisper 多语言转写，返回 segment 时间戳；Koma 的音频切片小于其免费档 25 MB 单文件限制。
- [OpenRouter Free Models Router](https://openrouter.ai/openrouter/free)：自动选择当前支持图片输入的免费模型。

免费服务仍然要求账户 Key，没有可信的“匿名无限免费”AI 接口。Key 只放在 Koma 服务端，浏览器不会拿到。免费额度会受账户级请求限制影响，因此演示模板默认限制：

- 视频最长 3 分钟；
- 单 IP 每个 UTC 日 3 次；
- 同时只分析 1 个任务。

结果会一直保留到删除。提交者可以从“我的任务”删除自己账号的任务，管理员也应定期在 `/admin` 查看存储占用并清理不需要的演示任务。

为演示用户配置 GitHub 登录，另用 `ADMIN_PASSWORD` 启用运营后台。若分析还需要管理员身份，设置 `ANALYSIS_REQUIRE_ADMIN=true`。每日限流只能减少请求量，不能替代身份验证或形成 SSRF 边界。

内置限流适合单机演示，多实例部署应在网关或共享存储中统一限流。nginx 后设置 `TRUST_PROXY=true` 前，必须确认代理会覆盖客户端伪造的 `X-Forwarded-For`。

## 常用组合

### 只用百炼

```dotenv
ASR_PROVIDER=dashscope
VISION_PROVIDER=dashscope
DASHSCOPE_API_KEY=...
```

### Groq 听写 + OpenRouter 免费视觉模型

```dotenv
ASR_PROVIDER=groq
GROQ_API_KEY=...
VISION_PROVIDER=openrouter
OPENROUTER_API_KEY=...
```

### Gemini 视觉 + Groq 听写

```dotenv
ASR_PROVIDER=groq
GROQ_API_KEY=...
VISION_PROVIDER=gemini
GEMINI_API_KEY=...
```

### 任意 OpenAI-compatible 服务

```dotenv
ASR_PROVIDER=openai-compatible
ASR_API_KEY=...
ASR_BASE_URL=https://example.com/v1
ASR_MODEL=whisper-model

VISION_PROVIDER=openai-compatible
VISION_API_KEY=...
VISION_BASE_URL=https://example.com/v1
VISION_MODEL=vision-model
```

视觉服务需要兼容 `POST /chat/completions` 和 `image_url`；听写服务需要兼容 `POST /audio/transcriptions`、multipart 上传和 `verbose_json` segment 时间戳。

## 全部变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务端口 |
| `ASR_PROVIDER` | `mock`（无 Key 时） | `mock`、`dashscope`、`groq`、`openai` 或 `openai-compatible` |
| `ASR_API_KEY` | Provider 对应 Key | 自定义或覆盖预设的听写 Key |
| `ASR_BASE_URL` | Provider 预设 | 自定义或覆盖听写 API 地址 |
| `ASR_MODEL` | Provider 预设 | 听写模型 |
| `VISION_PROVIDER` | `mock`（无 Key 时） | `mock`、`dashscope`、`openai`、`gemini`、`openrouter`、`groq` 或 `openai-compatible` |
| `VISION_API_KEY` | Provider 对应 Key | 自定义或覆盖预设的视觉 Key |
| `VISION_BASE_URL` | Provider 预设 | 自定义或覆盖视觉 API 地址 |
| `VISION_MODEL` | Provider 预设 | 视觉语言模型 |
| `AI_TIMEOUT_MS` | `120000` | AI 请求超时 |
| `PUBLIC_BASE_URL` | 空 | 服务公网地址；仅 DashScope 说话人分离需要 |
| `ASR_DIARIZATION` | `off` / 自动 | `on`、`off`；目前仅 DashScope 支持 |
| `MAX_UPLOAD_BYTES` | `524288000` | 最大上传大小（500 MB） |
| `MAX_DURATION_SECONDS` | `900` | 视频最长时长（15 分钟） |
| `FRAME_WIDTH` | `1280` | 关键帧宽度 |
| `FRAME_SCENE_THRESHOLD` | `0.4` | 场景变化阈值（0–1） |
| `MAX_FRAMES` | `18` | 关键帧数量上限 |
| `VISION_MAX_FRAMES` | `10` | 发给视觉模型的代表帧数；Groq 自动限制为最多 5 张 |
| `VISION_TRANSCRIPT_CHARS` | `30000` | 发给视觉模型的字幕字符上限 |
| `VISION_MAX_TOKENS` | `2000` | 视觉模型输出上限 |
| `ARTIFACT_MAX_TOKENS` | `6000` | 显式请求文件产物时的模型输出上限；普通总结仍使用上面的较小值 |
| `MAX_CONCURRENT_JOBS` | `2` | 同时分析的任务数 |
| `DEMO_REQUESTS_PER_IP_PER_DAY` | `0` | 单机按 IP 的每日提交上限；0 为关闭 |
| `TRUST_PROXY` | `false` | 是否信任反向代理提供的来源 IP |

旧版 `ANALYSIS_PROVIDER=openai-compatible` 仍可使用，但新配置应改用 `VISION_PROVIDER`。

## 管理平台与数据库

配置 `ADMIN_PASSWORD` 后可访问 `/admin`，在页面中修改 Provider、模型、Base URL 和 API Key。AI JSON 生成、视频地址分析和文件上传分析都需要 GitHub 登录；设置 `ANALYSIS_REQUIRE_ADMIN=true` 后，还需要独立的管理员会话。API Key 会先用 AES-256-GCM 加密再写入数据库，浏览器只会收到末四位掩码。建议额外配置稳定、随机的 `KOMA_CONFIG_SECRET`；如果省略则回退使用 `ADMIN_PASSWORD` 作为加密密钥。

本地默认使用 `DB_DRIVER=sqlite` 和 `./data/koma.sqlite`。线上可使用独立 MySQL 数据库：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 空 | 启用独立的 `/admin` 后台，不能代替 GitHub 登录 |
| `ANALYSIS_REQUIRE_ADMIN` | `false` | 已配置 `ADMIN_PASSWORD` 时，AI JSON 生成、地址/上传提交及重试还需管理员会话 |
| `KOMA_CONFIG_SECRET` | `ADMIN_PASSWORD` | Provider 配置加密密钥，推荐单独设置 |
| `DB_DRIVER` | `sqlite` | `sqlite` 或 `mysql` |
| `KOMA_DATABASE_PATH` | `./data/koma.sqlite` | SQLite 文件路径 |
| `DB_HOST` | 空 | MySQL 地址；不应写入公开仓库 |
| `DB_PORT` | `3306` | MySQL 端口 |
| `DB_USER` / `DB_PASSWORD` | 空 | 建议使用只拥有 `koma.*` 权限的独立账号 |
| `DB_NAME` | `koma` | MySQL 数据库名 |
| `DB_SSL` | `false` | 是否要求 TLS 连接 |
| `DB_CONNECTION_LIMIT` | `5` | MySQL 连接池大小 |
| `DB_AUTO_CREATE` | `true` | 启动时创建 `DB_NAME`；使用预创建的最小权限数据库时设为 `false` |

数据库保存 Provider 密文和完整 JSON 回看记录；视频、关键帧和生成文件只以对象 Key 建立索引，不把二进制内容写进数据库。完整部署方法见 [管理平台](ADMIN.zh-CN.md)。

## 持久化存储

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `STORAGE_DRIVER` | `local` | `local` 或 `oss` |
| `LOCAL_STORAGE_PATH` | `./data/storage` | 本地持久对象目录 |
| `OSS_REGION` | 空 | 阿里云 OSS 区域 |
| `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` | 空 | 仅服务端使用的 OSS 凭证 |
| `OSS_BUCKET` | 空 | OSS Bucket |
| `OSS_UPLOAD_PREFIX` | `koma` | 独立命名空间；任务位于 `koma/jobs/<id>/` |
| `OSS_PUBLIC_BASE_URL` | 空 | 私有工作区应留空；任务下载忽略此覆盖，使用签名 URL |
| `OSS_SIGNED_URL_SECONDS` | `900` | 签名回看地址有效期，最多一小时 |

新任务归属于登录的 GitHub 账号。回看、视频、关键帧和产物文件都需要该账号或管理员身份，仅有回看地址不能访问。未认领的旧链接保留原来的只读访问方式，直到原浏览器所有者明确认领。详见[迁移规则](ADMIN.zh-CN.md#旧任务与迁移)。永久删除会移除任务及其整个存储目录。

Koma 对新 OSS 对象显式设置私有 ACL，认领旧任务前也会先将整个任务前缀设为私有；共享 Bucket 权限保持不变。`OSS_PUBLIC_BASE_URL` 应留空；即使配置了该覆盖，任务下载仍然先校验权限，再使用签名 URL。拿到签名地址的人在有效期内仍可使用它。认领不能收回此前下载或缓存的公开内容，独立配置的公开 CDN 也不能绕过源站对象权限。

## 处理流程

1. 解析支持的视频链接，或接收本地上传的视频。
2. 使用 FFmpeg 抽取代表性画面。
3. 使用所选 ASR Provider 转写音频。
4. 使用所选视觉 Provider 分析关键帧和字幕。
5. 保存原视频、关键帧和生成文件，写入完整结果记录，再删除中间音频和工作目录。

## 支持站点

原生支持抖音和 B 站（`BV` 和 `b23.tv` 链接）。

安装 yt-dlp 后，可作为 YouTube、TikTok、小红书、微博、腾讯视频等站点的兜底解析方式。实际可用性取决于 yt-dlp 版本和目标站点的反爬策略。

目前不支持抖音图文、需要登录或会员权限的内容以及快手。
