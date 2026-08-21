# 上海地铁出入口 OSM 数据源

本目录把地铁出入口数据与厕所业务数据分开维护。运行时只使用固定快照生成的
`miniprogram/data/station-entrances.js`，不在小程序内请求地图服务，因此断网时仍可查询。

## 来源与许可

- 原始数据：OpenStreetMap contributors。
- 许可：Open Database License 1.0（ODbL-1.0）。
- 署名与许可说明：https://www.openstreetmap.org/copyright
- 在线刷新：`osm-shanghai-metro-entrances.overpass` 查询上海市行政区内的
  `railway=subway_entrance`、包含这些入口的 `public_transport=stop_area`，以及上海市内的
  `route=subway|light_rail` 关系。
- PBF 备选源：Geofabrik 上海每日 OSM 提取，包含 `.osm.pbf` 和 `.osc.gz` 增量：
  https://download.geofabrik.de/asia/china/shanghai.html

Overpass 与 Geofabrik PBF 都是同一份 OSM 数据的不同提取方式，不是两个独立权威来源。
默认刷新脚本使用 Overpass；需要离线或批量更新时，可从 Geofabrik PBF 提取相同三类元素，
再按下述精简快照结构写入。不得从上海地铁街区图、商业地图截图或无落库许可的接口补坐标。

## 关系语义

入口与线路只通过 OSM 标准关系派生：

1. 入口节点属于一个或多个 `public_transport=stop_area`；
2. `stop_area` 的站点／站台／停车点成员与 `route=subway|light_rail` 成员相交；
3. `route.ref` 映射到项目线路，再映射为该物理站的 `lineStationId`。

不解析 `note`、`name` 中的“X号线”自由文本来制造唯一线路。没有标准关系时保留
`association: "unknown"`；关联多条线路时保留 `association: "multiple"`。

## 固定快照结构

`osm-shanghai-metro-entrances.snapshot.json` 是精简、确定性排序的固定快照：

- `entrances`: `[osmNodeId, lat, lon, ref]`；
- `stopAreas`: `[relationId, name, members]`；
- `routes`: `[relationId, routeRef, routeType, members]`；
- `members`: `[typeCode, osmId]`，其中 `n/w/r` 分别代表 node/way/relation。

快照不保留与构建无关的 OSM 标签，尤其不保留 `note`，避免误用自由文本。原始 OSM 时间戳、
查询 SHA-256、Overpass 端点、ODbL 元数据和快照 SHA-256 会写入生成文件的 `source`。

## 刷新与构建

刷新会改变固定快照，必须先检查覆盖统计和 diff：

```sh
METRO_RESTROOM_CONTACT='https://github.com/BLOSEregedit/MetroRestroom' \
  node scripts/fetch_osm_station_entrances.js
node scripts/build_station_entrances.js
node scripts/validate_station_entrances.js
```

日常构建不访问网络，只运行后两条命令。生成数据继续依据 ODbL 使用；若对外分发 OSM
派生入口数据库，应保留 `© OpenStreetMap contributors` 署名、ODbL 链接，并按 ODbL
履行相应的数据库提供义务。
