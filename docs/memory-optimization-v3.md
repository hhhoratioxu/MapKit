# MapKit 4.6.1-optimized.3：清单编码内存

日期：2026-11-01。基线是上一发布版 `optimized-v2` / `ed182e205d764ab36eb7b50c946f34a8b28da01b`。本版固定运行引用为 `optimized-v3`，正式安装入口继续为 `MapKit.lpx`。

## 为什么还能降低

上一版已经减少了缓存副本和分组引用对象，但原 protobuf writer 会为每个嵌套 message 创建多个小 Uint8Array，保留为 chunks，直到上层合并和最后输出。瓦片分组会重复写入很多小 message，数十万个临时对象在编码阶段堆积。

本版通过原 schema 公开的 `writerFactory` 接口替换存储方式。新 `ManifestWriter` 继承锁定 `@protobuf-ts/runtime@2.11.1` 的标量处理，在连续缓冲内写入字段、回填长度前缀；缓冲从最多 1 KiB 起按需增长。嵌套块不再各自生成数组并留到结束，结果以精确有效长度的 Uint8Array 视图返回。

扩容前就检查 4 MiB 输出边界，超限时立即回退原响应。编码栈最多 64 层。扩容过程中旧/新缓冲可能短暂并存，返回视图可能保留未使用容量；4 MiB 是当前输出缓冲上限，不是总 JS 堆或 Loon 宿主限制。正文、解码对象、原生编码器与持久存储仍有各自开销。

地图功能、原 `@nsringo/mapkit@1.1.3` schema、未知字段、缓存格式/槽位、TTL、请求数、超时和失败回退保持。共享 codec 默认仍使用原 writer，只有 Loon Response 显式选择新 writer。Request 和 defaults bundle 与 optimized-v2 字节相同。

## 实际 bundle 对比

[memory-measurements-v3.json](memory-measurements-v3.json) 保存全部原始样本、bundle/fixture SHA-256 和环境。11 个自写场景，每个版本/场景五个全新进程、交替执行，共 **110 个测量进程**。固定时间与随机数，比较输出和持久记录的摘要，所有样本一致。另有 **22 个独立诊断进程**拦截 Uint8Array 构造以统计数量，不使用这些诊断进程的耗时/RSS 数据，避免拦截成本夸大收益。

以下是 macOS arm64 / Node v24.22.1 的中位数；峰值 RSS 包含整个 Node 进程、VM 和 fixture 初始化，不是 iPhone Loon 占用。两版在相同新测量方法下重新执行；不能拿这里的绝对数直接与上一报告的带构造器拦截测量作差。

| 合成场景 | v2 峰值 RSS | v3 峰值 RSS | RSS 变化 | v2 耗时 | v3 耗时 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 80 瓦片 / 3 分组 | 59.2 MiB | 58.1 MiB | -1.8% | 10.82 ms | 9.72 ms |
| 2000 瓦片 / 60 分组 | 100.8 MiB | 75.0 MiB | -25.5% | 310.67 ms | 214.64 ms |
| 15000 瓦片 / 4 分组 | 173.2 MiB | 115.8 MiB | -33.1% | 304.94 ms | 228.30 ms |
| 合成结果超限，原样放行 | 91.1 MiB | 79.1 MiB | -13.2% | 16.42 ms | 14.48 ms |

2000 瓦片/60 分组场景的显式 Uint8Array 构造由 **374198 次降至 13 次**。这个计数不包括 TextEncoder 原生内部分配、内部视图和宿主缓冲。15000 瓦片场景因连续缓冲增长，累计可观察字节分配反而从约 3.65 MiB 增至 4.59 MiB，但数组构造从 285030 次降至 14 次，整个进程峰值下降；累计分配量和同时存活内存不可混为一谈。

Request bundle 没有变化，其缓存读写/304 场景仅作为对照，不把时间或 RSS 波动计为新收益。缺少补充清单场景约增加 0.2 MiB RSS，超限主正文基本持平。小合成场景的完成时堆采样约增加 0.8 MiB，虽然 RSS 中位数下降；完成时采样包含未回收垃圾，不等于连续堆峰值。Response bundle 从 153128 增至 161520 字节，增加约 8.2 KiB，包括新 writer 及其标量依赖。这些代价均保留在结果中。

## 验证

- 149 项回归通过；新增全部 protobuf 标量、64 位边界、NaN/Infinity、UTF-8 孤立代理项、嵌套长度前缀、写入上限、返回视图复用隔离及 300 组原 schema/未知字段差分。
- 16 个实际 bundle 场景通过，新增多分组/未知字段编码与输出超限放行，并验证单次同步完成、原缓存不被修改。
- 110 个性能进程与 22 个分配诊断进程均核对新旧输出与持久记录一致；具体资源摘要随测量数据发布。
- [GitHub Actions](https://github.com/hhhoratioxu/MapKit/actions/runs/41320436185) 在 Linux/Node v22.23.4 上通过同样的 149 项回归、16 个编译场景、110 次测量与 22 次分配诊断；CI ZIP 完整性与六个运行资源字节核验通过。详见 [CI 验证记录](ci-validation-v3.json) 与 [云端原始样本](memory-measurements-v3-ci.json)。
- 尚未运行真实 Loon 配置解析器或用户 iPhone 验收，没有测量原生 Loon/Network Extension 峰值、耗电和长期 VPN 稳定性。桌面测量不能保证手机不掉 VPN。
