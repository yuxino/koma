# 管理平台

Koma 把账号归属和运营权限分开：

- GitHub 登录进入个人工作区；网页提交和 AI JSON 生成都需要登录账号。
- 新任务是私有的。所有者和已登录的管理员可以访问回看、视频、关键帧、提取 JSON 和生成文件；仅有任务 ID 无法访问，新任务也没有公开分享开关。
- `/admin` 使用独立的密码和会话，管理 Provider、密钥、全部任务和永久删除。GitHub 用户不会自动成为管理员。
- 任务详情展示保存的分析结果、提取要求、期望 JSON、输出格式，以及不含密钥的 Provider/模型快照。
- 已配置 `ADMIN_PASSWORD` 时，`ANALYSIS_REQUIRE_ADMIN=true` 可让 AI JSON 生成、分析提交和重试再要求管理员会话，但不能代替 GitHub 登录。

## 旧任务与迁移

升级会保留已有数据，不会把历史自动分配给第一个登录的人：

| 记录类型 | 升级后的访问方式 | 迁移方式 |
| --- | --- | --- |
| 新 GitHub 账号任务 | 仅所有者或管理员 | 已属于私有工作区 |
| 带浏览器归属哈希的旧任务 | 未认领时，旧回看链接保持只读可访问 | 在原浏览器登录，明确认领自己的旧任务 |
| 没有浏览器归属哈希的旧任务 | 原回看权限保持不变，由后台管理 | 不能从个人工作区认领 |

`GET /api/my/jobs/legacy` 只列出当前 `koma_viewer` Cookie 能证明归属、尚未认领的任务。`POST /api/my/jobs/claim` 把这些任务转入当前账号并设为私有，原链接接收者随后会失去后续回看权限。此前下载或缓存的公开内容无法收回，已经签发的地址也能使用到过期。认领不会取得其他浏览器的任务，不会覆盖已有账号归属，也不会分配无主记录。清除原浏览器 Cookie 后，无法再使用这条自助认领路径；仅知道任务 ID 不能证明归属。接口详见 [API](API.zh-CN.md#我的任务)。

升级前备份数据库和持久化存储，制作一致的恢复快照时暂停提交。启动会新增账号、会话、OAuth 尝试、账号归属和重试来源表，保留旧任务与浏览器归属记录。服务重启后，中断的分析会被标记为失败。账号任务若仍有来源 URL 或保存的视频，可以重试；重试创建新任务，并保留原失败记录。

数据库迁移是增量的，但旧服务不认识账号私有权限。**不能直接回滚到旧服务并继续公开任务和媒体接口。** 恢复一致的数据库/存储快照或修复新版本期间，应保持维护模式，确认账号权限校验恢复后再放行流量。恢复快照前还应另存升级后的数据。删除新增归属表不能构成隐私安全的回滚。

## 启用后台

在部署 Secret 或 `.env` 中配置：

```dotenv
ADMIN_PASSWORD=<随机的管理员登录密码>
ANALYSIS_REQUIRE_ADMIN=false
KOMA_CONFIG_SECRET=<另一段稳定的随机字符串>
```

`ADMIN_PASSWORD` 为空时后台完全禁用；配置后，管理员登录会建立独立的 12 小时 HttpOnly、SameSite=Strict Cookie，作用路径为 `/`；内存会话在服务重启后失效。连续错误登录会按 IP 限流。GitHub 账号会话存储在数据库，有效期为七天，与管理员会话相互独立；退出其中一种身份不会退出另一种。

身份验证不会校验 URL 的出站目标。允许不可信用户使用前，应另配出站策略或可信 URL 白名单；当前导入器尚未形成完整的 SSRF 边界。

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

`DB_AUTO_CREATE=true` 时，账号可自动创建 `koma` 数据库。Koma 启动时创建 `koma_settings`、`koma_jobs`、旧浏览器归属表 `koma_job_owners`，以及 `koma_accounts`、`koma_account_sessions`、`koma_oauth_attempts`、`koma_job_accounts`、`koma_job_sources`。若使用最小权限账号，先一次性创建数据库，只授予 `koma.*` 所需权限，再设为 `false`；升级建表权限仍需保留。

数据库保存 Provider 密文与完整回看记录：状态、不含 Key 的 Provider 快照、分析要求、字幕、总结、章节、标签、结构化 JSON、产物元数据和存储对象索引。数据库不保存 Provider Key 明文和二进制媒体。账号记录包含 GitHub 数字 ID、当前用户名、显示名和头像地址；会话令牌、OAuth state 和临时浏览器绑定只保存哈希，短期 PKCE verifier 保存在服务端。GitHub 访问令牌和刷新令牌不会持久化。

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

每个任务独占 `koma/jobs/<job-id>/`，其中包含 `video/`、`frames/` 和 `artifacts/`。新上传会显式把每个 OSS 对象设为私有，认领也会先把旧任务前缀中的全部对象设为私有，再分配账号；共享 Bucket 策略保持不变。`OSS_PUBLIC_BASE_URL` 应留空，任务下载接口始终请求签名 URL，不使用这个公开地址覆盖。Koma 先校验下载权限，再签发短时地址；持有该签名地址的人在有效期内仍可使用它。不要再通过公开 CDN 暴露同一批对象。

中间音频和工作文件在处理结束后删除；原视频、关键帧、结果和生成文件会一直保留。账号所有者从“我的任务”删除自己的任务，或管理员从后台永久删除时，数据库记录和该任务目录下的所有对象会一起移除。

数据库与 OSS 的真实账号密码只能放在部署 Secret 中，不能提交到公开仓库。
