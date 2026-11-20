# 独立猜词

使用 Node.js 24。从本目录安装依赖、构建并启动本地入口。

```sh
npm ci --prefix app
npm run setup
npm run build
npm run db:init
npm run db:seed
npm run dev
```

打开 http://127.0.0.1:8799/。本地测试入口为 `/auth/dev?next=%2Fchat%2F1`。安装脚本在本目录生成独立 `.dev.vars`，保留在本机。初始化数据库全新创建。外部服务默认关闭，依赖第三方服务的流程需要另外配置。

运行 `npm test` 可检查猜词、卧底画家、奖励、会话和隔离规则。源码保留独立游戏 Worker 和适配层。当前默认的本地入口不依赖主站的生产绑定。

自有代码采用 [MIT 许可证](LICENSE)。本地种子只创建默认群组。自动化测试使用合成账号、消息和游戏数据。
