#  MapKit · Loon 缓存与性能优化

基于 [NSRingo/MapKit](https://github.com/NSRingo/MapKit) 的原生 Fork，保留 VirgilClyne 与上游贡献者版权、Apache-2.0 许可证和完整 Git 历史。当前优化版本为 **4.6.1-optimized.1**，运行脚本固定在 `optimized-v1`。

与本账号 WeatherKit 的发布方式一致，提供独立仓库和一个 Loon 安装入口。

[一键导入 Loon](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fhhhoratioxu%2FMapKit%2Fmain%2FLoon%2Fscript%2FMapKit.lpx) · [插件订阅直链](https://raw.githubusercontent.com/hhhoratioxu/MapKit/main/Loon/script/MapKit.lpx) · [固定版本](https://raw.githubusercontent.com/hhhoratioxu/MapKit/optimized-v1-lpx/Loon/script/MapKit.lpx)

## 安装

需要 **Loon 3.5.1(983) 或以上**；系统要求沿用上游 iOS/iPadOS/macOS 15 及以上。在「配置 → 插件」添加订阅直链、启用并重载配置。运行脚本由插件自动加载，无需另下 JS 或配置个人 Token。

若已有其他 MapKit / iRingo Maps 脚本或 Rewrite 版，先停用旧版再启用本版，避免同一清单被重复处理。沿用已有 MitM 证书；首次使用按 [Loon 官方 MitM 文档](https://nsloon.app/docs/MitM/) 完成证书配置。

默认沿用上游的数据组合：美国资源清单、国内地图/2D 卫星/交通/兴趣点/道路/公共交通，以及国际 3D 卫星、俯瞰和四处看看；地点和导航使用高德，评分与照片使用 Apple。可在插件参数中分别修改。某地区是否有 3D 或四处看看数据，仍取决于 Apple 的覆盖与实际网络。

## 优化与修复

- 补充地区清单默认缓存 **1 小时**，新鲜缓存期间不发附加请求；过期优先使用 ETag 和 304。目标清单仍由 Apple 正常提供。
- 单次最多 **1 个串行附加请求**，默认超时 **3500 毫秒**，没有自动重试、轮询或后台刷新。失败后冷却 30 秒；Retry-After 限制在 30–300 秒。
- 查询失败时，仅使用同主机、同系统、同版本和完整查询参数匹配的有效旧补充清单，默认最长 24 小时。没有可用数据时保留 Apple 原响应。
- 修复上游写入一个地区缓存时清空其他地区缓存的问题。Loon 新入口使用独立命名空间与 **4 个固定槽位**，每份原始清单最多 1 MiB，不读取或清空其他插件数据。
- 请求脚本和普通配置响应不加载 protobuf 解析器；公告响应无需脚本。枚举转换原地处理数组，瓦片合并改为分组遍历；保留未知数字枚举与 protobuf 字段。
- 同时支持上游 `.com` 和 `.cn` 清单入口；补充请求仅带必要的内容协商与客户端标识 Header，不转发 Cookie 和 Authorization，不经过第三方 Worker。

此入口使用 Loon 插件参数，不读取 BoxJS 配置。`LocationShift=AUTO` 沿用上游按系统选择服务的规则；这里没有新增坐标转换算法。韩国地区可作为清单地区选择，但本版没有引入尚未合入上游的独立韩国瓦片合成。

## 验证

本地与 [GitHub Actions 执行日志](https://github.com/hhhoratioxu/MapKit/actions/runs/39284257494) 均确认 **89 项回归测试、12 个编译后脚本场景通过**，包括 400 组瓦片合并布局对比。下载的六个运行资源与本地生成文件逐字节一致。验证过程和状态页差异记录见 [CI 验证记录](docs/ci-validation.json)。完整说明见 [验证与边界](docs/optimization.md)，原始数据见 [工作量测量](docs/work-measurements.json) 与 [构建记录](docs/build-validation.json)。

脚本大小检查、Node/V8 测量与模拟接口测试不能代替真实 Loon 解析、iPhone 地图显示、耗电或 VPN 连续运行验收。真实设备验收尚未完成。

## 构建

GitHub Actions 使用临时 `GITHUB_TOKEN`，仅声明 `contents: read` 和 `packages: read`，从上游原始包安装锁定的 `@nsringo/mapkit@1.1.3`。普通安装用户不需要凭据。

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build:loon
node scripts/measure-work.mjs
```

重新发布时使用新的不可变版本引用，避免替换已发布运行脚本。`Loon/script/` 只存放一个安装文件、三个必要运行脚本及其许可证和校验值；开发与测试文件位于各自目录。其他客户端目录、云端适配与模板保留为上游源码，本次未声明其优化发布或原生验收。
