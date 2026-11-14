# MapKit

基于 [NSRingo/MapKit](https://github.com/NSRingo/MapKit) 的 Apple 地图服务配置与修复，保留原有地区、服务和图层选项。

- [Loon 插件](https://raw.githubusercontent.com/hhhoratioxu/MapKit/main/Loon/script/MapKit.lpx)
- [Mac 原生卫星 3D 修复与实机验收](docs/macos-native-repair-2026-11-14.md)

Loon 插件提供原有的 16 项选项，运行脚本固定到已验证的提交。Mac 原生修复工具需在本机单独运行，使用现有选项准备清单、备份、套用和还原；巴黎实景 3D、上海卫星 2D 及重开 Maps 后的保留结果已验收。系统后续更新原生清单时可能需要重新套用。

构建与自动回归：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build:loon
node --test test/*.test.js
```

原作者与本仓库修改的版权说明见 [NOTICE](NOTICE) 和 [LICENSE](LICENSE)。
