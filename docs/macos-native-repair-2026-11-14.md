# Mac 原生衛星 3D 修復

2026-11-14，macOS 27.3（26C5035r），MacBookPro18,1。

本次已在原生 Maps 看見巴黎鐵塔、周圍建物和地面的實景立體貼圖。成功畫面來自原生 Maps 視窗，原始截圖和診斷資料留在本機。

## 成功驗證的流程

1. 以 Mac 自帶 curl 和系統正常憑證驗證取得美區清單。
2. 由現有 Loon 回應腳本合成使用者選定的圖層，保留中國大陸底圖和衛星 2D，同時帶入國際衛星 3D。
3. 在原生配置快取啟用原版腳本既有的 `CountryProviders.CN.ShouldEnableLagunaBeach`。
4. 正常關閉 Maps，寫入兩份快取，再以目前帳戶的正常終止訊號讓 GeoServices XPC 程序重新啟動。
5. 在原生 Maps 以巴黎鐵塔、60 度傾角驗收。

先前只重開 Maps 的兩次試驗均未顯示巴黎立體影像。本次使用者帳戶的 GeoServices 從 PID 709 重新啟動為 8439 後，觀察到實景立體貼圖。`launchctl kickstart` 受到 SIP 限制，後續採用目前帳戶正常可用的 SIGTERM 和 XPC 按需重啟。此結果驗證上述組合流程，個別開關的必要性仍未以獨立對照完全確定。

依五分鐘試驗授權，獨立還原程序已把兩份快取恢復為試驗前的完整位元組，並讓背景程序重新讀入原設定。該次成功結果屬於受控試驗。

## 正式套用驗收

2026-11-14，使用者明確同意正式套用並保留本機修復。工具已使用既有完整 16 項設定完成套用，包含 `Satellite2D=CN`、`Satellite3D=XX`，驗收結果如下。

- 原生 Maps 顯示巴黎鐵塔、周邊建物和地面的實景 3D 貼圖。
- 上海外灘正常顯示中國區衛星 2D 影像。
- 正常關閉並重新開啟 Maps 後，巴黎實景 3D 仍正常顯示。
- 工具狀態為 `applied`，兩份原生快取均與已驗證候選資料的雜湊一致；未保留試驗還原計時程序。

修復前備份、還原計畫與三張原生視窗驗收截圖保留在僅目前帳戶可讀的 `.cache/macos-native-repair-*` 目錄。完整自動測試已通過 63 項，其中 8 項驗證本機工具的參數、清單保留、引用、原子寫入和還原邊界。自動測試及上述實機畫面僅涵蓋已驗收範圍，尚未驗證所有城市或後續系統更新。

## 本機工具

`scripts/macos-native-repair.mjs` 提供 `prepare`、`apply`、`status` 和 `restore`。

`prepare` 讀取目前中國區原生清單，以正常 HTTPS 取得目標地區資料，並呼叫實際編譯的 Loon 回應腳本在記憶體中合成。它驗證圖層引用，把候選資料和原始備份存入獨立、僅目前帳戶可讀的 `.cache` 目錄。

輸入為既有 Loon 的完整 16 項設定 JSON，也可使用包含 `arguments` 物件的紀錄。工具會拒絕缺少或無效的選項，避免靜默回退至其他圖源。

```sh
node scripts/macos-native-repair.mjs prepare /path/to/existing-arguments.json
node scripts/macos-native-repair.mjs status /path/printed/by/prepare
node scripts/macos-native-repair.mjs apply /path/printed/by/prepare
node scripts/macos-native-repair.mjs restore /path/printed/by/prepare
```

`apply` 會保留本機修復並重開 Maps 和目前帳戶的 GeoServices。套用前，原生快取必須仍與準備時相同。過程中出錯會嘗試還原，備份可供後續手動恢復。

`restore` 撤回本工具擁有的變更。原生服務另外更新的清單會保留，若只有外層資料變動，還原會保留新的外層資料。配置快取中其他新變更也會保留。

## 適用範圍

目前流程驗證了這台 Mac 的中國區原生來源和既有 `2D=CN`、`3D=XX` 設定。普通海外衛星 2D 的覆蓋仍取決於使用者的 2D 圖源選項。

原生服務後續更新可能替換修復後的快取，屆時需要重新準備與套用。此工具屬於本機相容性修復，後續持續更新行為仍需驗證。Loon 插件自身的 HTTPS 腳本無法執行本機程序重新載入。既有 DB 版的 55 項腳本測試與本次原生驗收各自有上述範圍。
