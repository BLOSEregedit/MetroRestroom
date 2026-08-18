# 上海地铁站点坐标来源

更新时间：2026-08-18

## 首版口径

- 坐标源：OpenStreetMap 一次性 Overpass 快照。
- 坐标系：WGS84；小程序定位同样请求 `wgs84`，本地使用 Haversine 计算距离。
- 运行时不调用地图服务，不保存用户经纬度，只在本地保存最近一次确认的线路站 ID 和时间。
- 数据范围：518 条 active 线路站，合并为 411 个 active 物理站；江杨南路未开通，排除在附近站计算之外。

## 许可与署名

站点坐标数据 © OpenStreetMap contributors，依据 Open Database License（ODbL）1.0 使用。

- 版权与许可：https://www.openstreetmap.org/copyright
- 归因指南：https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
- 地铁站映射说明：https://wiki.openstreetmap.org/wiki/Metro_Mapping

发布前需要在小程序“关于”页保留上述署名和许可链接。坐标层与厕所业务数据分文件存放，避免混淆数据许可边界。

## 可复现流程

1. `data/osm-shanghai-metro.overpass` 固定查询范围和标签条件。
2. `scripts/fetch_osm_stations.js` 下载一次原始快照并输出 SHA-256。
3. `scripts/build_station_locations.js` 只读取固定快照、拓扑和人工覆盖表，确定性生成 `miniprogram/data/station-locations.js`。
4. 构建必须同时达到 411／411 个物理站和 518／518 条 active 线路站，否则失败。

当前受执行环境网络限制，原始 Overpass 快照尚未下载；因此坐标文件保持 `dataReady: false`，小程序不会请求定位权限，也不会伪装成智能定位。

## 后续权威校验

随申行开放平台的地铁线路接口可返回 GPS 点位，适合作为后续抽检来源；接入需要商户信息、盐值和出口 IP 白名单，并需书面确认坐标落库及再发布许可。在这些条件明确前，不作为首版运行时依赖。

- 接口说明：https://open-web.shmaas.cn/docs/public-traffic/%E6%9F%A5%E8%AF%A2%E5%9C%B0%E9%93%81%E8%B7%AF%E7%BA%BF/
- 接入规则：https://open-web.shmaas.cn/docs/guide/
