# ETA V2 与多城市数据交付设计

## 1. 总体方案

ETA V2 使用“统一维护源、完整本地基线、可选原子更新”的三层模型：

```text
一城一 Excel 工作簿
        ↓ 导入、来源核对、引用校验
CloudBase 审核后 activeVersion
        ↓ 导出同一份规范快照
代码包完整基线 + 本地已验证缓存
        ↓ 纯本地路径与 ETA 计算
首页单值“约 X 分钟”
```

Excel 是人工采集和批量导入格式；CloudBase 是审核后的统一维护与发布源；代码包和本地缓存是小程序运行数据。三者职责不同，不把 Excel 直接当运行时数据库，也不让首页依赖在线查询。

## 2. 逻辑数据层

| 层 | 内容 | 更新特点 | 是否包含 UI |
| --- | --- | --- | --- |
| `core` | 城市、线路、物理站、线路站、路径、方向、换乘图、稳定 ID | 低频 | 否 |
| `detail` | 卫生间实体、位置原文、结构化导视、线路站关联、入口 | 低频人工核实 | 否 |
| `eta` | 相邻站有向时分、常规运营间隔、换乘和卫生间步行时间、数据等级 | 随公开资料或实地核实更新 | 否 |
| `status` | 维护、关闭、未知及生效区间 | 可独立低频发布 | 否 |

分层是校验、版本和代码职责边界，不等于每层必须单独发起网络请求。现有运行 JSON 的实测体积为：`topology 24,491 B / gzip 5,724 B`、`restrooms 122,191 B / gzip 10,435 B`、`locations 114,055 B / gzip 16,109 B`、`entrances 279,542 B / gzip 26,422 B`，合计 `540,331 B / gzip 59,549 B`；ETA V2 预计增加约 `66,610 B / gzip 6,046 B`，上海完整城市数据约 `607 KB raw`。若按线路强拆，共享站、坐标、入口和换乘关系会重复，估算反而增至约 `711 KB raw / 91 KB gzip`。因此 V2 首版按城市一次批量取得目标版本，不按线路强拆。

物理发布单元采用以下工程阈值，而不是微信或 CloudBase 的官方硬限制：

- `<= 256 KB raw`：一个城市使用一个 `city-data` part，一次响应取得。
- `256—700 KB raw`：仍按城市一次批量拉取，可将不可变 part 控制在 `128—256 KB raw`，全部校验后一次激活。
- `> 700 KB raw`：按 `core/detail/eta` 或版本化文件拆分，但不得按线路复制共享数据。
- 任一单模块 `> 512 KB raw`：改用版本化文件下载或分页，不塞入单个云函数响应文档。

微信／CloudBase 平台边界只用于留安全余量：小程序端云函数响应上限按 `1 MB` 约束，单个小程序代码包 `2 MB`、全部分包合计 `30 MB`，本地缓存总上限 `10 MB`，`wx.request`／`wx.uploadFile`／`wx.downloadFile` 并发上限均为 `10`。这些上限不应被当作目标容量；上面的 `256／700／512 KB` 才是本项目的保守工程门槛。

WXML、WXSS、JavaScript、图片、动效和交互配置始终只在代码包中。远端数据只能填充既有 schema 定义的字段。

## 3. ETA 单值模型

### 3.1 定义

ETA 表示用户到达所选计算起点站后，到达目标具体卫生间的典型耗时。用户此时尚未完成首次候车，因此首次平均候车必须计入。以下时间不包含在 ETA 中：

- 到地铁站的地面步行；
- 从地面入口到可乘车区域的进站步行和安检；
- 临时故障、拥挤、节假日加班车或临时运营调整；
- 使用卫生间后的返程。

### 3.2 公式

所有输入统一使用秒，路径完成后只舍入一次：

```text
etaSeconds =
  initialExpectedWaitSeconds
  + sum(trainSegmentSeconds)
  + originDirectionWalkSeconds
  + sum(transferWalkSeconds)
  + sum(transferExpectedWaitSeconds)
  + sum(sameLineServiceChangeSeconds)
  + restroomWalkSeconds

expectedWaitSeconds = typicalHeadwaySeconds / 2
rawMinutes = etaSeconds / 60
roundingStep = rawMinutes < 10 ? 1 : (rawMinutes <= 30 ? 2 : 5)
displayMinutes = etaSeconds > 0
  ? max(1, roundHalfUp(rawMinutes / roundingStep) * roundingStep)
  : 0
label = "约 " + displayMinutes + " 分钟"
```

约束：

- `trainSegmentSeconds` 是有向相邻站边的典型运行时间。
- `initialExpectedWaitSeconds` 是起点实际乘坐方向常规典型间隔的一半，任何需要乘车的路径都必须计入一次。
- 起点当前方向可直达时，`originDirectionWalkSeconds = 0`，但仍计入首次期望候车。
- 普通线路锚点另一侧仍只按实际所需方向的典型间隔计算首次期望候车。`originDirectionWalkSeconds` 只允许记录已经核实的额外站内换向步行；V1 默认 `0`，不得继承旧版 `reverseAtOrigin 4—6 分钟` 固定范围。
- 跨线换乘后的乘车需要另计期望候车；行程起点的首次期望候车也必须计入，两者分别只计一次。
- 同线支线存在直达服务时不增加换车；没有直达服务、必须改乘另一服务路径时才增加同线换车步行与候车。
- 目标同站时列车运行区间为 0，仍可有换线、换向和卫生间步行时间。
- 只有目标卫生间无需乘车即可到达时，`initialExpectedWaitSeconds = 0`。

### 3.3 阶梯舍入

舍入只在总秒数求和结束后执行一次，采用半刻度向上：

- 原始结果 `< 10` 分钟：最近 1 分钟；
- 原始结果 `10—30` 分钟，含 10 和 30：最近 2 分钟；
- 原始结果 `> 30` 分钟：最近 5 分钟。

例如 `9分29秒 → 9 分钟`、`9分30秒 → 10 分钟`、`11分00秒 → 12 分钟`、`29分00秒 → 30 分钟`、`32分29秒 → 30 分钟`、`32分30秒 → 35 分钟`。

### 3.4 数据优先级

每条时间边都保存一个正式计算值和来源等级，不向用户展示 min/max：

1. `official`：官方直接公开的相邻站时分或运行时间。
2. `timetable_derived`：由官方相邻站时刻差推导。
3. `public_verified`：其他公开资料交叉核实。
4. `line_median_fallback`：使用同线路已确认区间中位数。
5. `global_fallback`：兼容阶段使用现有常量中点。

`uncertaintySeconds`、`verificationStatus` 和 `method` 只用于维护和测试。卡片始终展示单值，避免把内部不确定性直接放大为宽区间。

### 3.5 常规运营间隔

首版可以维护 `daily_baseline`、`regular_weekday`、`regular_weekend` 三类常规时段。若当前本地时间匹配具体时段，则使用该时段的典型间隔；否则使用线路常规基准。

不接入临时公告，不因节假日、高低峰临时调整而改变计算。时刻与间隔在数据发布时离线固化，运行时不请求运营方网站。

## 4. 拓扑处理

### 4.1 环线

- 环线使用两个有向闭环方向，首尾闭环边必须有独立时分。
- ETA 遵循用户当前选择的内圈或外圈，不在计算时擅自改选另一圈。
- UI 的首尾跳转只是浏览行为，不创建额外站点或额外耗时边。

### 4.2 支线

- `route` 表示实际可运行路径，`servicePattern` 表示常规服务模式。
- 共享主干边只维护一组相邻站时间；确有服务差异时由服务模式覆盖。
- 分支站之间不得按 Excel 行顺序建边。
- 路径搜索先确认是否存在从起点到目标的直达服务，再决定是否增加同线换车。

### 4.3 换乘与同站

- 换乘边连接两个 `lineStationId`，同时保存典型步行秒数和是否需要出闸。
- 同一物理站的多条线路不代表零成本换乘。
- 同一卫生间可以关联多个线路站，每个关联可有独立 `restroomWalkSeconds`。
- 同一物理站的多个卫生间不得因站名相同自动合并。

## 5. 一城一 Excel 工作簿

每座城市使用一个独立工作簿，所有城市复制同一 schema。核心工作表如下：

| 工作表 | 主键／关键字段 | 责任重点 |
| --- | --- | --- |
| `city` | `city_id`、名称、时区、生效日期 | 维护者确认 |
| `lines` | `line_id`、名称、颜色、类型、状态 | 线上查询后核对 |
| `physical_stations` | `physical_station_id`、名称、坐标 | 名称可查，坐标可查后抽检 |
| `line_stations` | `line_station_id`、`line_id`、`physical_station_id` | 线上查询后核对 |
| `station_aliases` | 别名、适用线路、有效期 | 线上查询／冲突人工确认 |
| `routes` | `route_id`、主支线角色、环线、端点 | 官方资料优先 |
| `route_stations` | `route_id`、`sequence`、`line_station_id` | 官方资料优先 |
| `directions` | `direction_id`、标签、终点、遍历方式 | 官方资料优先 |
| `transfers` | 两个线路站、换乘类型、典型步行秒数 | 关系可查，时间宜实地核实 |
| `restrooms` | `restroom_id`、闸区、位置原文、结构化位置 | 位置必须逐步实地核实 |
| `restroom_line_links` | 卫生间与线路站、典型步行秒数 | 共享关系与时间实地核实 |
| `segment_times` | 有向相邻站、典型秒数、方法、来源 | 官方时刻推导后抽检 |
| `service_patterns` | 方向、常规时段、首二班、典型间隔 | 官方资料整理 |
| `entrances` | 出入口编号、坐标、线路关系 | 可线上查，歧义需实地核实 |
| `sources` | 发布方、标题、URL、日期、哈希 | 每次线上整理必填 |
| `verifications` | 实体、字段、方法、人员角色、日期、结果 | 人工核实必填 |

稳定 ID 必须写回并保存在工作簿中。`source_row` 仅用于审计，不能再作为业务主键。

### 5.1 责任分级

- `owner_required`：城市范围、纳入线路、未开通线路处理、数据冲突是否发布等产品决定。
- `online_research`：线路、站序、拓扑、方向、公开时刻、坐标、官方换乘关系。
- `onsite_required`：卫生间数量和具体位置、是否出闸、共享关系、实际步行时间、入口歧义。
- `derived`：稳定版本哈希、图边、路径总时长、显示短文案、缺失率和质量报告。

模板应允许数据单元格保持空白，并通过 `collection_status` 或 `verification_status` 明确“待线上整理”或“待实地核实”，不得以推测值填满表格。

## 6. CloudBase 发布模型

### 6.1 维护源与运行快照

Excel 导入 CloudBase 的 staging 数据后，完成 schema、主外键、来源和业务规则校验。审核通过的数据生成不可变城市快照；同一 activeVersion 同时导出到：

1. 小程序代码包中的完整基线；
2. CloudBase 的可下载数据版本；
3. 本地回归测试夹具。

这样 CloudBase 是统一维护发布源，但运行时始终有与已发布代码相匹配的完整本地基线。

### 6.2 Manifest 与原子切换

逻辑 manifest：

```json
{
  "cityId": "shanghai",
  "schemaVersion": 2,
  "activeVersion": "sha256-...",
  "parts": [
    { "key": "city-data", "version": "sha256-...", "sha256": "..." }
  ],
  "statusVersion": "sha256-...",
  "effectiveAtMs": 0,
  "minClientSchema": 2
}
```

城市数据 `<= 256 KB raw` 时默认只有一个 `city-data` part，其中包含 `core + detail + eta`；`256—700 KB raw` 时可以声明多个 `128—256 KB raw` 的 part，但仍保持一次城市批量下载和一次原子激活。`status` 可保持独立版本。超过工程阈值后的拆分仍是一份清单、一次批量获取和一次城市版本切换。

按第 2 节的工程阈值，上海约 `607 KB raw` 属于 `256—700 KB` 档：保持一个城市批次，可把 part 控制在 `128—256 KB raw`，但不得拆成逐线路请求。批量响应连同 JSON 包装必须留在小程序端云函数 `1 MB` 响应边界内；接近边界时优先改用版本化文件下载，不以压缩后体积掩盖未压缩响应风险。

客户端缓存状态：

```json
{
  "cityId": "shanghai",
  "activeVersion": "sha256-...",
  "candidateVersion": "",
  "verifiedAtMs": 0,
  "parts": {}
}
```

更新步骤：

1. 读取本地 `activeVersion` 和 manifest。
2. 版本相同则只更新时间，不下载正文。
3. 版本变化时，一次请求全部缺失 part。
4. 写入候选区，校验 schema、哈希、主外键、数量与内部版本。
5. 全部成功后原子切换 `activeVersion`。
6. 任一步失败则删除或忽略候选区，继续使用旧缓存；旧缓存不可用时回退代码包基线。

### 6.3 安全边界

- 客户端继续只调用云函数，不直接读写业务集合。
- 数据集合、导入批次和发布快照保持仅管理端可写。
- manifest 不得引用未完整写入并回读验证的 part。
- V2 集合、索引、权限、数据上传和云函数部署属于后续受控操作，需单独确认。

## 7. 本地模块边界

建议新增纯数据模块，而不改变页面直接消费的 ViewModel 契约：

- `dataset-loader`：解析代码包基线、本地 activeVersion 和状态覆盖。
- `dataset-validator`：校验 schema、哈希、引用和覆盖率。
- `eta-graph`：使用有向运行边、换乘边和设施步行边计算秒级单值。
- `dataset-importer`：把统一 Excel 转成规范 JSON，并输出来源与缺失报告。
- `catalog`：继续负责把规范数据转成首页、抽屉和纠错页需要的结构。

## 8. 测试策略

### 数据测试

- 稳定 ID 唯一且不随 Excel 行序变化。
- 所有外键有效，所有 active 路径连续。
- 普通线双向边、环线闭环边和支线独有边完整。
- 每条 active 运行边都有正式或降级时间值，并记录方法。
- 每个 active 卫生间至少关联一个线路站。

### ETA 测试

- 同站、同方向、反方向、单次换乘、多次换乘。
- 4 号线内外圈闭环。
- 5、10、11 号线直达与必须换车两类路径。
- 无需乘车的同站目标不计首次候车；所有需要乘车的路径恰好计入一次首次期望候车。
- 普通线路锚点另一侧按实际乘车方向的首次期望候车计算，`originDirectionWalkSeconds` 在没有核实数据时为 `0`，不叠加固定 `4—6 分钟`。
- 总秒数最后一次阶梯舍入，覆盖 10 分钟和 30 分钟分段边界，以及各刻度的半刻度向上边界。
- 删除官方时分后按固定优先级降级，结果仍为单值。

### 发布与回退测试

- manifest 不变时不下载正文。
- 候选 part 缺失、哈希错误、schema 不兼容、引用非法和本地写入失败时均不切换 activeVersion。
- 清空缓存或断网时，代码包上海完整基线仍可完成查询。
- V1 状态覆盖在 V2 本地基础数据启用后仍可兼容应用，直到受控上线新的同步协议。
- 用实测体积验证 `256／700／512 KB` 工程阈值、`128—256 KB` part 目标和 `1 MB` 响应余量；证明逐线路拆分不会被误启用。
