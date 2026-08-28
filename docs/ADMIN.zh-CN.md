# 管理平台

Koma 把产品和运营能力分开：

- `ADMIN_PASSWORD` 为空时，普通访客免登录提交，获得不可猜的 `/jobs/<id>` 永久回看链接；当前浏览器还能在“我的任务”里查看和删除自己提交的任务。
- 配置 `ADMIN_PASSWORD` 后，同一个管理员会话还会保护 AI JSON 生成、视频地址提交和文件上传；拿到链接的人仍可读取只读回看页面。
- `/admin` 是受保护的运营后台，用于管理 Provider、密钥、任务和永久删除。
- 任务历史里的“详情”会展示当次分析结果、提取要求、期望 JSON 结构、输出文件格式，以及不含密钥的 Provider/模型快照。
- 当前不做公开用户账号系统。任务归属使用长期 HttpOnly 匿名 Cookie，数据库只保存令牌哈希；分享链接的其他访问者只能查看，不能据此删除任务。
- 上线此功能之前创建、没有归属记录的旧任务仍只在管理后台出现，不能被某个访客浏览器认领。

## 启用后台

在部署 Secret 或 `.env` 中配置：

```dotenv
ADMIN_PASSWORD=<随机的管理员登录密码>
KOMA_CONFIG_SECRET=<另一段稳定的随机字符串>
```

`ADMIN_PASSWORD` 为空时后台完全禁用，AI JSON 生成和分析提交保持公开。配置后，登录会建立一个 12 小时 HttpOnly、SameSite=Strict Cookie，同时用于 `/admin` 和三个受保护的分析接口；连续错误登录会按 IP 限流。

这层权限适合私人单用户部署，但不会校验 URL 的出站目标。若保持公开分析，应另配出站策略或可信 URL 白名单；当前导入器尚未形成完整的 SSRF 边界。

`KOMA_CONFIG_SECRET` 使用 AES-256-GCM 加密 Provider API Key，应独立于登录密码并长期保持稳定。浏览器、健康检查和任务 API 都不会返回 Key 明文。

## 数据库

本地默认使用零配置 SQLite。生产环境可以接独立 MySQL 分库：

```dotenv
DB_DRIVER=mysql
DB_HOST=<私有地址>
DB_PORT=3306
DB_USER=<Secret 中的账号>
DB_PASSWORD=<Secret 中的密码>
DB_NAME=koma
DB_SSL=false
DB_AUTO_CREATE=true
```

`DB_AUTO_CREATE=true` 时，账号可自动创建 `koma` 数据库，Koma 启动时创建 `koma_settings`、`koma_jobs` 和匿名归属表 `koma_job_owners`。若使用最小权限账号，先一次性创建数据库并只授权 `koma.*`，然后设为 `false`。

数据库保存 Provider 密文与完整回看记录：状态、不含 Key 的 Provider 快照、分析要求、字幕、总结、章节、标签、结构化 JSON、产物元数据和存储对象索引。数据库不保存 Provider Key 明文和二进制媒体。

后台任务列表默认只读取轻量元数据；只有管理员点开某个任务的详情时，才会读取并展示该任务的完整配置和结果。详情也提供完整回看与生成文件下载入口。

## 持久化存储

本地开发：

```dotenv
STORAGE_DRIVER=local
LOCAL_STORAGE_PATH=./data/storage
```

生产环境使用阿里云 OSS：

```dotenv
STORAGE_DRIVER=oss
OSS_REGION=<区域>
OSS_ACCESS_KEY_ID=<Secret>
OSS_ACCESS_KEY_SECRET=<Secret>
OSS_BUCKET=<Bucket>
OSS_UPLOAD_PREFIX=koma
OSS_SIGNED_URL_SECONDS=900
```

每个任务独占 `koma/jobs/<job-id>/`，其中包含 `video/`、`frames/` 和 `artifacts/`。私有 Bucket 默认返回短时签名下载地址；只有可信的公开/CDN 域名才配置 `OSS_PUBLIC_BASE_URL`。

中间音频和工作文件在处理结束后删除；原视频、关键帧、结果和生成文件会一直保留。提交者从“我的任务”删除自己的任务，或管理员从后台永久删除时，数据库记录和该任务目录下的所有对象会一起移除。

数据库与 OSS 的真实账号密码只能放在部署 Secret 中，不能提交到公开仓库。
