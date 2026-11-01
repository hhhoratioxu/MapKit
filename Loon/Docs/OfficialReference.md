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

## 安装入口后缀

2026-10-20：按用户要求将当前安装文件统一为 `MapKit.lpx`，同步构建、校验、CI 收集路径和安装链接。重新阅读官方插件正文与参数规范；官方该页没有限制远程订阅 URL 的扩展名，因此不据此宣称旧 `.plugin` 链接必然无效。运行脚本字节与 `optimized-v1` 固定引用保持不变。

## 4.6.1-optimized.2 内存优化

2026-11-01 重新核对官方 [Script](https://nsloon.app/docs/Script/script_v2/) 的正文执行阶段与 [Script API](https://nsloon.app/docs/Script/script_api/) 的 Uint8Array、同步字符串存储和一次完成约定。Response 已经取得完整正文且没有附加异步工作，改为同步处理后直接 `$done`；Request 的缓存命中、冷却和忽略路径也同步完成。实际 HTTP 路径仍等待原生回调，只处理首个回调，没有新增定时器或取消请求假设。

缓存仍使用相同命名空间、JSON 格式、四个槽位和容量。请求检查直接遍历现有 Base64 字符串，完整验证编码、protobuf 边界、缓存键和 generation，只有响应合成才分配二进制清单。带转义或非标准字段顺序的旧 JSON 继续受限解析。写入使用最多 8192 字节临时编码区，分组引用仅在单次响应的编码期间共享。

`.lpx` 正式入口、最低版本 3.5.1(983)、原生参数、MITM、正文上限、输出上限、TTL、请求数、超时和冷却不变。没有声明宿主内存配额；完整正文和存储字符串仍由 Loon 提供。117 项自动测试、14 个编译后场景与桌面内存测量不代表真实 iPhone 峰值或 VPN 稳定性验收。

## 4.6.1-optimized.3 连续缓冲编码

2026-11-01 重新核对官方 [Script API](https://nsloon.app/docs/Script/script_api/) 的 Uint8Array 正文、同步完成约定，以及 [Script](https://nsloon.app/docs/Script/script_v2/) 的完整正文阶段。Loon Response 继续同步返回 Uint8Array 的有效长度视图，只完成一次；网络、缓存、参数、超时和最低版本未新增宿主能力。

仅替换原 schema 的 writerFactory：使用锁定 protobuf runtime 的标量处理和自有受限连续缓冲写入，避免积累每个字段的临时块。每次扩容前核对既有 4 MiB 输出边界，编码栈限 64 层；这是工程边界，不是 Loon 内存限制。扩容时旧/新缓冲可短暂并存，返回视图可能保留少量未使用容量，宿主输入和解码对象仍独立占用内存。未知字段、整数/浮点数/UTF-8 与原 schema 输出经差分验证。149 项回归、16 个实际 bundle 场景及桌面测量不代表 iPhone 原生内存和 VPN 稳定性验收。
