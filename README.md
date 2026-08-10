# 火花台 · 自媒体创意管理平台

本地单页 Web 应用，使用 Express、SQLite 和 LiteLLM 管理创意、稿件、发布记录与运营原则。

## 启动

```bash
npm install
node server.js
```

打开 <http://localhost:3000>。服务启动时会自动创建 `data/content.db` 和 `exports/`，并在空数据库中写入示例数据。

AI 功能默认请求 `http://localhost:4000/v1/chat/completions`：

- 文案生成与润色：`glm-5.2`
- AI味检查与创意评分：`glm-4.7-flash`

可通过 `LITELLM_URL`、`LITELLM_MODEL`、`LITELLM_FAST_MODEL` 和 `LITELLM_API_KEY` 环境变量覆盖默认配置。
