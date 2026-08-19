# MetroRestroom 项目约束

## 项目边界

- 本项目是微信原生小程序；小程序代码位于 `miniprogram/`，云函数位于 `cloudfunctions/`。
- CloudBase 环境固定为 `metro-restroom-d4goyb1fq3f9df0b3`，小程序 AppID 固定为 `wx5b829b09e2d525b3`。
- 线路、站点、厕所和坐标数据随小程序本地打包；断网或云端异常不得阻塞本地查询。
- 最近记录、用户偏好和定位结果只保存在本地。

## 云开发边界

- 小程序客户端仅通过 `metroRestroomApi` 调用云端，不直接读写业务集合。
- 云函数使用 `cloud.getWXContext().OPENID` 识别调用者；只保存不可逆哈希，不返回或持久化原始 `OPENID`。
- `data_versions`、`correction_reports`、`correction_rate_limits` 必须保持仅管理端可读写。
- 云端资源变更必须显式指定环境 ID，并优先使用 CloudBase MCP。

## 开发与验证

- 项目进度以 `ROADMAP.md` 为准；完成并验证开发或云端资源变更后同步更新。
- 云开发本地回归运行 `node scripts/validate_cloud.js`。
- 完成 CloudBase 相关代码或配置变更后执行 CloudBase code review。
- 上传、发布、远端 Git 操作以及删除或回滚操作必须另行获得用户确认。
