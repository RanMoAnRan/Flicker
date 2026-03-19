# Render 一体化部署设计

## 目标

在没有自备服务器的前提下，将当前仓库以前后端一体的方式部署到 Render，并尽量不改动现有业务代码。

## 现状

- 前端页面为原生 HTML、CSS、JavaScript。
- 后端入口为 `proxy-server.js`，同时负责静态文件分发和 `/api/proxy`、`/api/music/*` 接口。
- 运行时依赖 Node.js 和系统 `curl`。

## 方案选择

采用 Render 的 Node Web Service 原生运行时，直接连接 GitHub 仓库自动部署。

选择该方案的原因：

- 不需要自备服务器。
- 不需要拆分前后端域名。
- 不需要把现有 Node 逻辑改写成 Cloudflare Workers。
- Render 原生运行时提供 `node`、`npm`、`curl`，满足当前项目依赖。

## 部署设计

- 仓库新增 `render.yaml`，声明为单个 `web` 服务。
- 构建命令使用 `npm install`。
- 启动命令使用 `npm start`。
- 健康检查路径使用 `/`。
- 固定 Node 版本到 20，避免平台默认版本变化造成行为漂移。

## 风险与边界

- 音乐搜索与播放依赖第三方插件和上游站点，线上稳定性仍受外部源影响。
- 若后续需要更多系统级依赖或完全锁定运行环境，可再切换到 Docker 部署。
- 免费实例可能存在冷启动，首次访问会比本地开发慢。

## 验收标准

- Render 成功从 GitHub 拉取仓库并完成构建。
- 服务启动后可以直接访问首页。
- `index.html`、`music.html` 可正常打开。
- `/api/proxy` 和 `/api/music/plugins` 返回正常响应。
