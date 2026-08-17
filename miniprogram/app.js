// app.js
App({
  onLaunch: function () {
    this.globalData = { env: "" };
    // 原型阶段使用本地数据；配置环境 ID 后再启用云开发。
    if (wx.cloud && this.globalData.env) {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
    }
  },
});
