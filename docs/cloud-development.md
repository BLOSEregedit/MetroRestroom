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

固定文档 `_id = restroom-data`：

```json
{
  "_id": "restroom-data",
  "latestVersion": "完整的厕所数据 SHA-256",
  "releaseNote": "可选更新说明",
  "updatedAt": "服务端时间"
}
```

首版只提示版本状态，不在线覆盖本地基础数据。

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

## 上线前云端操作

以下操作会改变云端资源，执行前需要用户确认：

1. 关联小程序 AppID。
2. 创建 `data_versions`、`correction_reports` 和 `correction_rate_limits` 集合并设置权限、索引。
3. 部署 `metroRestroomApi` 云函数。
4. 写入首条 `restroom-data` 版本记录。
