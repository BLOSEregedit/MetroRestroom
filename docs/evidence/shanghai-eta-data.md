# 上海轨道交通 ETA 数据证据说明

## 目的与边界

本数据集用于离线估算上海轨道交通相邻站行车时间和常态候车时间。运行时不得请求上海地铁网站；官方公开数据只在开发阶段由生成脚本采集、核验并固化到小程序本地包。

数据集只表达常态计划值，不处理实时晚点、节假日加班车、临时运行图和突发运营调整。

## 官方来源

- 线路与站点：<https://m.shmetro.com/interface/metromap/metromap.aspx?func=lineStations&line=1>
- 预计下车时间：<https://service.shmetro.com/jhndcx/index.htm>
- 路径时分接口样例：<https://m.shmetro.com/interface/plantrip/pt.aspx?func=plantrip&startId=0111&endId=0138&planTime=12%3A00&week=1&ticket=oneWay&type=1>
- 18 号线首末班接口：<https://m.shmetro.com/interface/metromap/metromap.aspx?func=fltime&line=18>
- 首末班与行车间隔：<https://service.shmetro.com/hcskb/index.htm?line=1>
- 上海市轨道交通运营服务规范：<https://jtw.sh.gov.cn/2025ngfxwj/20250122/45e2177ec30648c696ad6f5b5b9739a1.html>

上述 JSON 地址是上海地铁官方页面实际调用的公开端点，但不是带稳定性承诺的开放 API。脚本必须保留采集日期、来源地址和覆盖率；官方页面结构变化时应停止生成并人工核验，不能静默写入错误数据。

## 数据契约

`miniprogram/data/generated/segment-times.js` 至少导出：

- `schemaVersion: 1`
- `cityId: 'shanghai'`
- `defaults.segmentSeconds: 180`
- `defaults.headwaySeconds: 360`
- `segments['lineStationId>lineStationId']: seconds`
- `headways['lineId:routeId:directionId']: seconds`

站间时间按方向分别保存，不假设双向相同。`segments` 的键始终表示当前运行时 active 拓扑中的有向边，不保证它仍是最新官方线网中的物理相邻站。没有官方值的 active 边不写入 `segments`，由运行层显式使用 `defaults.segmentSeconds`；不得伪装成官方采集结果。

当前本地拓扑尚未包含 11 号线的龙耀路、康恒路，以及 14 号线的浦东大道。因此，云锦路—东方体育中心、浦三路—御桥、浦东南路—源深路保存的是官方路径经过上述中间新站后的整段计划时间。这些记录属于“有官方路径依据的本地拓扑聚合区间”，不是官方物理相邻站时分；明细记录在 `coverage.byLine[].collapsedOfficialPaths`。

18 号线江杨南路当前标记为未开通，运行时不会把它作为可浏览节点。生成器与运行时保持同一口径：排除爱辉路—江杨南路、江杨南路—长江西路共 4 条原始有向边，改为爱辉路—长江西路 active 聚合边。官方路径规划接口未返回该区间时，生成器核对官方首末班接口：爱辉路往航头方向至长江西路的首班、末班时差均为 4 分钟，反向时差均为 5 分钟，因此分别固化为 240 秒和 300 秒。方法、来源和原始时间证据记录在 `collapsedOfficialPaths`，排除项记录在 `excludedInactiveDirectedEdges`。

代表间隔采用官方时刻表中的工作日平峰值。存在大小交路或支线时，按当前拓扑的具体 route 保存能够完整走完该 route 的代表间隔；平均候车时间取代表间隔的一半。该平均候车值是产品推导值，不是官方逐班发车时间。

## 采集规则

1. 以 `miniprogram/data/topology.js` 的 active 站点序列为运行时相邻关系唯一来源，未开通站从运行图中过滤；不能从官方站点数组顺序猜测支线或闭环。
2. 以 `miniprogram/data/generated/restrooms.js` 的 `lineStationId` 作为运行时主键。
3. 对每条本地拓扑有向边查询同线、无换乘路径；请求起终点必须与返回起终点一致。若官方路径中出现本地拓扑尚未收录的中间站，则保存官方整段计划时间，并登记为本地拓扑聚合区间。
4. 4 号线必须覆盖上海体育馆—宜山路闭环边；5、10、11 号线必须分别覆盖每条合法支线，禁止生成已知假边。
5. 上海存在多点首班，通常禁止把相邻站首班时间差当作站间时分，也禁止据此推算第二班。唯一允许的兜底是：运行时因跳过未开通站形成 active 聚合边、路径规划接口缺失，并且同方向首班与末班时差唯一且完全一致，同时相关站点不是首末班起讫标记；此时可标记为 `timetable_derived`。
6. 未开通站及其原始边进入排除审计，不计入 active 覆盖率；active 边官方暂缺或名称无法可靠对应时才进入缺失清单并使用回退值。

## 已知限制

- 官方路线分钟为整数，可能包含计划停站和分钟取整，不具备秒级精度。
- `timetable_derived` 同样是分钟级计划推导值，只能用于满足上述交叉一致条件的特定 active 聚合边，不能推广成全网首班差分算法。
- `planTime`、`week` 在已核验样例中不改变相邻站及换乘分钟，因而这些值视为静态路线成本，不视为实时到站数据。
- 官方未提供明确的数据再发布许可证。项目只保存规范化事实、来源与核验记录，不复制官方页面版式或图片。
