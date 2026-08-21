# 云开发接入说明

## 环境

- 环境 ID：`metro-restroom-d4goyb1fq3f9df0b3`
- 小程序 AppID：`wx5b829b09e2d525b3`
- 客户端只保存环境 ID，不保存任何 SecretId、SecretKey 或 API Key。
- CloudBase 控制台需要在“环境配置 → 安全配置 → 小程序关联”中绑定上述 AppID。

## 运行边界

- 线路、拓扑、厕所和站点坐标继续随小程序本地打包；断网或云端异常不影响查询。
- 客户端仅通过 `metroRestroomApi` 云函数访问云端，不直接读写数据库。
- 云函数通过 `cloud.getWXContext()` 取得 `OPENID`，仅用于纠错追踪、幂等和限流；不返回客户端。
- 最近记录、偏好和定位站点只保存在本地。

## 集合

### `data_versions`

用于检查本地数据是否存在更新。集合权限设为“仅管理端可读写”。

当前已部署的兼容文档 `_id = restroom-data`：

```json
{
  "_id": "restroom-data",
  "latestVersion": "完整的厕所数据 SHA-256",
  "releaseNote": "可选更新说明",
  "updatedAt": "服务端时间"
}
```

当前已部署版本只提示全局版本状态，不在线覆盖本地基础数据；目标方案上线后保留该文档仅用于兼容旧客户端。

同步方案在同一集合中使用一份城市 manifest 和不可变线路快照。线路、站点和换乘拓扑不进入快照，继续随小程序打包；线路快照只保存厕所数据的当前低频覆盖集合，而不是增量事件流或实时运营数据。

城市 manifest 的文档 ID 固定为 `sync_manifest_shanghai`：

```json
{
  "_id": "sync_manifest_shanghai",
  "cityId": "shanghai",
  "schemaVersion": 1,
  "ttlSeconds": 43200,
  "lineVersions": {
    "2": "sha256v12",
    "8": "sha256v8"
  },
  "updatedAt": "服务端时间"
}
```

线路快照的文档 ID 固定为 `sync_line_shanghai_<lineId>_<version>`。快照一经发布不得原地修改；任何内容变化都生成新版本文档，最后再更新 manifest：

```json
{
  "_id": "sync_line_shanghai_8_sha256v8",
  "cityId": "shanghai",
  "lineId": "8",
  "version": "sha256v8",
  "schemaVersion": 1,
  "overrides": [
    {
      "restroomId": "l8-s010-restroom",
      "restroomStatus": "maintenance",
      "reason": "临时维护",
      "effectiveFromMs": 1787000000000,
      "expiresAtMs": 1787086400000
    }
  ]
}
```

线路 `version` 是长度不超过 64、仅含字母、数字、下划线或连字符的安全不透明字符串，可使用规范化 `overrides` 的 SHA-256；若采用哈希，输入不包含 `_id` 和 `version`，避免自引用。`restroomStatus` 仅允许 `maintenance`、`closed`、`unknown`；某厕所没有覆盖记录时表示正常沿用本地数据。`reason`、`effectiveFromMs`、`expiresAtMs` 均可省略，时间存在时必须为正安全整数，且结束时间必须晚于开始时间。每条线路最多包含 128 条覆盖，`restroomId` 最长 80 个字符，`reason` 最长 120 个字符。单站更新只发布受影响线路的新快照；换乘站共享厕所影响多条线路时，为每条相关线路发布新快照并一起更新 manifest。

### `correction_reports`

用于保存待审核的纠错反馈。集合权限设为“仅管理端可读写”，客户端不得直接访问。

```json
{
  "_id": "OPENID 与 requestId 的哈希",
  "requestId": "客户端幂等 ID",
  "userKey": "OPENID 的不可逆哈希，仅云端写入",
  "lineId": "2",
  "stationId": "l2-s014",
  "stationName": "人民广场",
  "restroomId": "l2-s014-restroom",
  "sourceSheet": "2号线",
  "sourceRow": 15,
  "issueType": "location",
  "description": "应为 3 号口外",
  "contact": "可选，最多 100 字",
  "clientVersion": "开发版",
  "dataVersion": "本地厕所数据 SHA-256",
  "status": "pending",
  "createdAt": "服务端时间",
  "createdAtMs": 1787000000000
}
```

建议建立复合索引：`status` 升序、`createdAtMs` 降序。

### `correction_rate_limits`

用于原子记录匿名用户的每日提交次数。集合权限设为“仅管理端可读写”。文档 ID 由匿名用户哈希和 UTC+8 日期生成；每次有效提交与纠错记录在同一数据库事务中写入。

```json
{
  "_id": "userKey 与日期的哈希",
  "userKey": "OPENID 的不可逆哈希",
  "bucket": "2026-08-18",
  "count": 1,
  "lastAcceptedAtMs": 1787000000000,
  "updatedAt": "服务端时间"
}
```

首版限制为每个匿名用户每天最多 5 条，两条不同反馈至少间隔 30 秒。相同 `requestId` 的重试不重复计数。

## 云函数接口

统一调用云函数 `metroRestroomApi`：

- `getDataVersion`：返回最新数据版本；集合未初始化时返回“暂无云端版本”，不得阻塞首页。
- `submitCorrection`：校验字段、执行匿名限流、按 `requestId` 幂等写入待审核记录。

云函数只返回公开状态码和反馈编号，不返回 `OPENID`、数据库错误详情或其他用户数据。

## 已确认待实施的同步机制

### 自动检查

- 小程序启动和重新进入前台时先读取本地同步元数据，不直接发起云函数请求。
- 自动检查以 `lastAlignedAt` 为准；距上次成功核对不足 12 小时不请求，超过 12 小时才异步检查。
- 首屏、路径和预计耗时先使用本地数据计算并展示，检查过程不得阻塞查询。
- 当前查询跨线路时，只把路径涉及且缓存缺失或过期的线路合并为一次请求；同一次检查使用 single-flight，避免并发重复调用。
- 云端版本一致或新数据完整应用后，才更新相关线路的 `lastAlignedAt`；失败不得更新时间或覆盖旧缓存。

当前 `metroRestroomApi` 函数代码已扩展：

- `syncRestroomStatus`：接收城市、相关线路及本地版本，一次读取城市线路版本清单，只返回发生变化的线路快照。
- 路径和 ETA 在客户端本地计算；云函数不为每次起终点或厕所查询实时计算耗时。

请求结构：

```json
{
  "action": "syncRestroomStatus",
  "payload": {
    "schemaVersion": 1,
    "cityId": "shanghai",
    "lines": [
      { "lineId": "2", "version": "sha256v12" },
      { "lineId": "8", "version": "" }
    ]
  }
}
```

`schemaVersion` 当前只接受 `1`，`cityId` 当前只接受 `shanghai`。`lines` 必须包含 1—20 条已知线路且不得重复；`version` 必须是字符串，首次同步使用空字符串，非空值遵循线路版本字符限制。自动检查只提交当前派生路径中缓存缺失或已超过 12 小时的线路；手动检查在城市级 5 分钟冷却允许时，可提交当前路径的全部线路以强制核对。拨轮中心站是当前查询的派生目标站；客户端本地计算从起点到该站的完整路径，并提交去重后的途经线路。

成功响应结构：

```json
{
  "schemaVersion": 1,
  "cityId": "shanghai",
  "checkedAtMs": 1787000000000,
  "ttlSeconds": 43200,
  "unchangedLineIds": ["2"],
  "changedLines": [
    {
      "lineId": "8",
      "version": "sha256v8",
      "overrides": []
    }
  ]
}
```

`checkedAtMs` 必须由云函数使用服务端时间生成。`schemaVersion: 1` 的 `ttlSeconds` 固定为 43200 秒，manifest 缺少该字段时仍按 43200 秒处理，任何其他数值均视为云端数据未就绪并整批返回 `DATA_NOT_READY`；第一版客户端也不得用其他值改变 12 小时检查周期。未来如需动态 TTL，必须升级 `schemaVersion` 并重新定义客户端兼容规则。云函数先读取 manifest，再读取本次所有发生变化的不可变快照；请求线路未出现在 manifest，或 manifest 引用的任意目标快照缺失、版本不一致、结构非法时，整批返回 `DATA_NOT_READY` 和 `retryAfterSeconds: 900`，不得返回部分成功。客户端也必须先校验完整批次，再以单个城市缓存对象原子写入各线路快照；只有整批成功后，才以同一个 `checkedAtMs` 更新本次所有请求线路的 `lastAlignedAt`。

### 手动检查与重试

- 用户可通过明确的刷新入口主动发起检查；一次手动检查成功后进入上海城市级 5 分钟冷却期，不因切换线路或目标站绕过冷却。
- 冷却期内点击不请求云端，提示检查已完成，并使用 `YYYY-MM-DD HH:mm` 告知下次允许检查的时间。
- 手动请求失败不进入 5 分钟成功冷却，但设置城市级 10 秒防连点窗口；窗口结束后允许用户再次手动重试。
- 手动检查对超时、断网和临时服务错误最多尝试 3 次（含首次），建议间隔约 2 秒、5 秒；确定性的参数或权限错误不重试。
- 启动时的后台自动检查不做短时间连续三次重试；失败批次为相关线路分别写入 `nextRetryAt`，至少延后 15 分钟再尝试这些线路，手动检查不受该自动退避限制。

### 客户端同步状态

每条线路内部保存：

```json
{
  "cityId": "shanghai",
  "lineId": "8",
  "version": "sha256v8",
  "lastAlignedAt": 1787000000000,
  "nextRetryAt": 0,
  "ttlSeconds": 43200,
  "bundleSchema": 1,
  "overrides": []
}
```

城市级同步元数据另存 `lastManualSuccessAt` 和 `manualBlockedUntil`：前者计算手动成功后的 5 分钟冷却，后者记录手动失败后的 10 秒防连点。自动失败退避由每条线路的 `nextRetryAt` 保存。`lastAlignedAt` 只取服务端成功响应的 `checkedAtMs`；快照变化时，必须在本地完整应用成功后再写入。

- 当前路径涉及多条线路时，界面“最近同步”取相关线路中离现在最近的 `lastAlignedAt`；所有相关线路均在 12 小时内核对成功时才显示绿色。
- 首页与个人页在当前年份显示 `MM-DD HH:mm`，跨年份显示 `YYYY-MM-DD HH:mm`；均不显示数据库版本、整库更新时间、两位年份或相对时间。
- 绿色圆点：当前路径全部线路仍在 12 小时新鲜期内，显示 `已同步 · MM-DD HH:mm`。
- 蓝色圆点：本地数据可用，但云端新鲜度未确认、已过期或检查失败；有记录时显示 `本地数据 · 上次 MM-DD HH:mm`，否则显示 `本地数据 · 尚未同步`。
- 请求进行中保留原绿色或蓝色圆点与时间，右侧刷新图标旋转并显示“更新中”；失败后显示“重试”。
- 首页所有状态都保留无边框、无底色的“刷新图标＋更新／更新中／重试”，不使用长条胶囊；个人页只展示同款紧凑状态，不重复提供手动入口，关于页不再承载数据同步状态。

## 上线前云端操作

以下操作会改变云端资源，执行前需要用户确认：

1. 关联小程序 AppID。
2. 创建 `data_versions`、`correction_reports` 和 `correction_rate_limits` 集合并设置权限、索引。
3. 部署 `metroRestroomApi` 云函数。
4. 写入首条 `restroom-data` 版本记录。
