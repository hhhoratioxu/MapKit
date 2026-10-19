# Loon 官方文档适配记录

核对日期：2026-10-20。本 Fork 的 Loon 入口按 Proxy 仓库用户约定，以官方文档为首要依据。

- [总览](https://nsloon.app/docs/intro/)
- [Script](https://nsloon.app/docs/Script/script_v2/)
- [Script API](https://nsloon.app/docs/Script/script_api/)
- [Rewrite](https://nsloon.app/docs/Rewrite/rewrite_v2/)
- [插件](https://nsloon.app/docs/Plugin/)

采用 3.5.1(983) 起支持的原生 Script 和插件对象参数。select/input 显式标注 string 或 number，switch 标注 boolean；默认项列在 select 首位。script 对象参数仅引用本插件已经声明的参数。

每条 Response Script 都包含必需的 URL Guard，清单和 XML 分别声明 requires_body，清单使用 binary_body_mode=true 和 Uint8Array。公告没有无效的 Response Script；配置请求 Header 删除由官方原生 `request.header.del` 执行，该行为不会禁用对应 Response Script。

附加 HTTP 使用官方公开字段，timeout 单位为毫秒；使用严格 TLS、不自动跟随重定向、不自动保存 Cookie。异步回调结束后才执行单次 `$done`，不依赖 clearTimeout 或取消 HTTP。原生总超时和单请求超时分别约束工作。

缓存使用 `$persistentStore.read(key)`、`write(string,key)`，没有使用会清空全部脚本数据的 `remove()`。不假设存储事务、全局单例脚本实例或跨执行原子锁。容量、输入和分组数量边界为本项目的工程限制，不是 Loon 官方内存保证。

不移植 Surge 的 engine 或 max_size 等参数，不改用户网络、DNS 或代理节点。测试与真机结论见 [优化记录](../../docs/optimization.md)。
