# openai-image-relay

轻量 OpenAI 图片兼容 Relay：将上游图片接口返回的 `url` 下载并转换为纯 Base64 `b64_json`，供 New API / n8n 的图片渠道使用。

## 本地运行

```powershell
Copy-Item .env.example .env
# 编辑 .env，至少设置 UPSTREAM_BASE_URL；生产环境设置两个 API Key
npm test
npm start
curl http://127.0.0.1:3100/health
```

Relay 不解析或缓存上传的 multipart body，而是原样流式转发；只在上游响应阶段处理 `data[].url`。已有 `b64_json` 的条目保持不变，多图逐条处理。

## Docker

```powershell
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3100/health
```

容器以非 root 用户运行，仅绑定宿主 `127.0.0.1:3100`，不会占用公网端口。`.env` 不应提交到版本库。

GitHub Actions 会在 `main` 推送后发布镜像。VPS 上直接使用：

```bash
docker pull ghcr.io/yilin101/openai-image-relay:latest
docker run -d --name openai-image-relay --restart unless-stopped \
  --env-file /www/wwwroot/openai-image-relay/.env \
  -p 127.0.0.1:3100:3100 ghcr.io/yilin101/openai-image-relay:latest
```

该仓库为 Private，VPS 拉取前需要使用具有 `read:packages` 权限的 GitHub Token 登录 GHCR：

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u yilin101 --password-stdin
```

## 配置

`RELAY_API_KEY` 校验 New API 到 Relay 的 Bearer Key；`UPSTREAM_API_KEY` 仅由 Relay 注入到上游请求，二者必须分离。`MAX_IMAGE_SIZE_MB` 限制下载图片大小，下载仅允许 HTTP/HTTPS，并拒绝常见私网地址。

默认模型列表包含 `gpt-image-2`、`gpt-image-2.5-flare` 和 `gpt-image-2.5-sunburst`。模型名会随图片请求原样转发给上游；如果上游不支持某个模型，会返回上游自己的错误。可通过 `MODEL_IDS` 调整 `/v1/models` 列表。

## 路由

- `GET /health`
- `GET /`
- `GET /v1/models`
- `POST /v1/images/edits`
- `POST /v1/images/generations`
- `POST /v1/images/variations`

## New API

同一 Docker 网络时 Base URL 使用 `http://openai-image-relay:3100`；独立 Compose 时将两个项目加入同一个 external network。不要额外拼接 `/v1`，由客户端请求 `/v1/images/...`。

## 安全边界

Relay 不记录 Authorization、API Key、完整 prompt 或图片内容；上游错误状态和响应体尽量原样透传。生产部署前应在宝塔 Nginx 设置 `proxy_request_buffering off`、上传大小和 360 秒超时。
