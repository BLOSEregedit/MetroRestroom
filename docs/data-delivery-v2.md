# 多城市数据采集与交付 V2

## 1. 文档定位

本规范定义从城市 Excel、CloudBase 审核发布到小程序本地数据的统一链路。它不改变以下产品底线：

- 每个已发布版本都在代码包中携带完整、可独立查询的基础数据。
- CloudBase 是审核后的统一维护和发布源，不是首页每次查询的运行依赖。
- 页面、样式、动效和业务代码只通过小程序代码包发布。
- 云端新版本失败时继续使用本地有效版本，不把半份数据暴露给页面。

现有上海运行 JSON 实测为：`topology 24,491 B / gzip 5,724 B`、`restrooms 122,191 B / gzip 10,435 B`、`locations 114,055 B / gzip 16,109 B`、`entrances 279,542 B / gzip 26,422 B`，合计 `540,331 B / gzip 59,549 B`。ETA V2 预计约 `66,610 B / gzip 6,046 B`，上海完整城市数据约 `607 KB raw`。若强制逐线路投影，坐标、入口、物理站和换乘等共享数据会重复，估算约 `711 KB raw / 91 KB gzip`。第一版 V2 因此按城市批量拉取，不为追求形式上的拆分发起逐线路请求。

## 2. 一城一工作簿

文件建议：

```text
data/cities/
  shanghai/metro-data.xlsx
  hangzhou/metro-data.xlsx
  nanjing/metro-data.xlsx
```

每个工作簿复制同一模板。第一行使用固定英文 `snake_case` 字段名；中文说明、类型、枚举、责任和示例放在 `_schema` 工作表。数据工作表不得合并单元格，不以颜色表达唯一业务含义，不使用 Excel 行号作为业务 ID。

已生成的可复制空白模板位于 `outputs/eta-v2-template-20260822/城市地铁数据模板.xlsx`。模板包含 `_README`、`_schema` 和 16 张标准数据工作表，共定义 230 个字段；枚举字段带下拉校验，日期、时间、整数和坐标列带对应格式。

### 2.1 通用审计字段

除纯关系表外，主要实体统一包含：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `city_id` | text | 稳定城市 ID |
| `status` | enum | `active`、`unopened`、`inactive` |
| `source_id` | text | 主要来源 |
| `collection_status` | enum | `complete`、`pending_online`、`pending_onsite`、`conflict` |
| `verification_status` | enum | `unverified`、`public_verified`、`onsite_verified`、`stale` |
| `valid_from` | date | 生效日期，可空 |
| `valid_to` | date | 失效日期，可空 |
| `note` | text | 维护备注，不直接展示给用户 |

### 2.2 核心工作表和字段

#### `city`

- 必填：`schema_version`、`city_id`、`city_name_zh`、`timezone`、`operator_name`、`dataset_effective_date`。
- 可选：`city_name_en`、`default_locale`。
- 自动派生：`dataset_version`、`source_hash`。

#### `lines`

- 主键：`line_id`。
- 必填：`city_id`、`public_line_code`、`line_name_zh`、`color_hex`、`line_type`、`display_order`、`status`。
- 可选：`line_name_en`、`official_branch_role`、`opened_date`。
- 枚举：`line_type = linear | loop | branched`。

#### `physical_stations`

- 主键：`physical_station_id`。
- 必填：`city_id`、`station_name_zh`、`status`。
- 可线上查询：`station_name_en`、`latitude`、`longitude`、`coordinate_system`、`opened_date`。
- 坐标系统统一使用 `WGS84`；其他坐标必须先明确转换来源和方法。

#### `line_stations`

- 主键：`line_station_id`。
- 必填：`line_id`、`physical_station_id`、`station_status`。
- 可线上查询：`official_station_code`、`station_name_on_line`、`opened_date`。

#### `station_aliases`

- 主键：`alias_id`。
- 必填：`physical_station_id`、`alias_name`、`alias_type`。
- 可选：`line_id`、`valid_from`、`valid_to`。

#### `routes`

- 主键：`route_id`。
- 必填：`line_id`、`route_name`、`route_role`、`is_loop`、`is_default`。
- 可选：`split_line_station_id`、`start_terminal_id`、`end_terminal_id`。
- `route_role` 只有官方明确主支线时才写 `main` 或 `branch`；否则使用 `unspecified`。

#### `route_stations`

- 联合唯一键：`route_id + sequence`。
- 必填：`route_id`、`sequence`、`line_station_id`。
- 自动派生：相邻运行边、首尾闭环边检查。

#### `directions`

- 主键：`direction_id`。
- 必填：`route_id`、`direction_label`、`traversal`、`is_default`。
- 可选：`terminal_line_station_id`。
- `traversal = forward | reverse | outer | inner`。

#### `transfers`

- 主键：`transfer_id`。
- 必填：`physical_station_id`、`from_line_station_id`、`to_line_station_id`、`transfer_type`、`bidirectional`。
- 可线上查询：`paid_area_continuity`、`requires_reentry`、`description`。
- 宜实地核实：`walk_seconds_typical`、闸内外连续性和实际换乘路径。

#### `restrooms`

- 主键：`restroom_id`。
- 必填：`physical_station_id`、`facility_status`、`access_scope`、`location_raw_zh`。
- 结构化字段：`requires_exit`、`zone_type`、`near_exit_ref`、`toward_station_id`、`car_position`、`transfer_corridor_line_id`、`location_short_zh`、`features`。
- 必须实地核实：设施数量、闸区、是否出站、具体出口、车头车尾、换乘通道和共享关系。
- 原始描述与结构化字段同时保留；结构化结果不得覆盖原文。

#### `restroom_line_links`

- 联合唯一键：`restroom_id + line_station_id`。
- 必填：`restroom_id`、`line_station_id`、`relation_type`。
- 宜实地核实：`is_primary`、`walk_seconds_typical`、`walking_note`。

#### `segment_times`

- 主键：`segment_time_id`。
- 必填：`line_id`、`from_line_station_id`、`to_line_station_id`、`travel_seconds_typical`、`value_method`。
- 可选：`service_pattern_id`、`uncertainty_seconds`。
- `value_method = official | timetable_derived | public_verified | line_median_fallback | global_fallback`。
- 上下行分别保存；不能依赖运行时自动假设对称。

#### `service_patterns`

- 主键：`service_pattern_id`。
- 必填：`route_id`、`direction_id`、`day_type`、`headway_seconds_typical`。
- 可线上查询：`reference_line_station_id`、`period_start`、`period_end`、`first_departure_time`、`second_departure_time`、`last_departure_time`。
- 不录入节假日临时加开和临时调整。

#### `entrances`

- 主键：`entrance_id`。
- 必填：`physical_station_id`、`entrance_ref`、`latitude`、`longitude`、`coordinate_system`。
- 可线上查询：OSM 元素、线路关联和出口状态。
- 必须实地核实：线上关系为 `unknown`／`multiple` 且会影响线路选择的入口。

#### `sources`

- 主键：`source_id`。
- 必填：`source_type`、`publisher`、`title`、`url`、`retrieved_at`。
- 可选：`published_date`、`effective_from`、`effective_to`、`license`、`snapshot_sha256`。

#### `verifications`

- 主键：`verification_id`。
- 必填：`entity_type`、`entity_id`、`field_names`、`verification_method`、`verification_status`、`verified_by_role`、`verified_at`、`result`。
- 可选：`source_id`、`next_review_date`、`note`。

## 3. 空白人工采集模板

新增城市时先填可线上查询的数据，实地字段保持空白并标记状态：

```text
collection_status = pending_onsite
verification_status = unverified
```

不得用“应该在站厅”“通常在闸内”等推测补齐。人工采集表至少允许现场人员记录：

- 是否实际存在、共有几处；
- 闸内、闸外或站外，是否需要出站；
- 所在层级、出口、通道、方向和车头／车尾；
- 与哪些线路站直接相连；
- 从对应线路站可行动区域到设施的典型步行秒数；
- 核实日期、人员角色、现场备注和冲突照片编号。

照片本身不进入基础 Excel 单元格，可用受控证据 ID 关联；是否启用照片上传和存储需另行设计隐私与云存储边界。

## 4. 导入门禁

导入必须检查：

1. 工作表、字段名、类型和枚举完整。
2. 主键唯一，外键存在，稳定 ID 未因排序变化。
3. active 路径站序连续，环线闭合，支线不存在假相邻。
4. 换乘边属于同一物理站或有明确出站换乘证据。
5. 每个 active 卫生间至少关联一个 active 线路站。
6. 每个 active 有向运行边都有单值时分或明确降级方法。
7. 每条公开资料记录都有来源和获取日期。
8. `pending_onsite` 不得被误标为 `onsite_verified`。

## 5. 发布与回退

### 5.1 发布顺序

1. Excel 导入 staging。
2. 运行全量质量检查并生成差异报告。
3. 人工审核差异和冲突。
4. 生成规范化不可变快照和哈希。
5. 写入全部快照并回读验证。
6. 最后更新城市 manifest 的 `activeVersion`。
7. 从同一 activeVersion 生成代码包完整基线和回归夹具。

### 5.2 客户端优先级

```text
有效本地 activeVersion
  > 代码包完整基线

status 覆盖只叠加在已验证基础版本上
```

客户端获取新版本后先写候选区。只有 schema、哈希、引用和数量全部通过，才一次性切换 `activeVersion`。失败不得修改旧版本的同步时间、正文或版本指针。

### 5.3 物理拆分规则

- `<= 256 KB raw`：一个城市使用一个 `city-data` part，内部含 `core + detail + eta`，另有小型 `status`。
- `256—700 KB raw`：仍按城市作为一次批量获取和一次激活的发布单元，可将不可变 part 控制在 `128—256 KB raw`。
- `> 700 KB raw`：按逻辑模块或版本化文件拆分；任一单模块 `> 512 KB raw` 时改用版本化文件下载或分页。
- 上述 `256／700／512 KB` 是项目工程阈值，不是微信或 CloudBase 的官方硬限制；调整前必须重新做真实体积、下载耗时、内存和本地存储测试。
- 多 part 仍必须由一份 manifest 声明、一次批量获取、全部校验、一次原子激活。
- 不以线路数量本身作为拆分理由，不把一个小城市强拆成大量独立请求。

已核验的平台边界为：小程序端云函数响应按 `1 MB` 控制；单个小程序代码包 `2 MB`、全部分包合计 `30 MB`；本地缓存总上限 `10 MB`，且单个 key 上限 `1 MB`；`wx.request`、`wx.uploadFile`、`wx.downloadFile` 最大并发均为 `10`。发布门禁必须为 JSON 包装、候选版本和未来增长留出余量，不能以接近官方上限作为正常方案。

## 6. CloudBase 变更边界

本规范只确定未来数据形态。以下事项都属于线上状态变更，必须另行列明风险并取得确认：

- 新建 staging、release、manifest 或 snapshot 集合；
- 修改现有 `data_versions` 结构、权限或索引；
- 上传正式城市数据；
- 部署支持 V2 的云函数；
- 将某城市 manifest 切换到新 `activeVersion`。
