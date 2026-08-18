const restroomData = require('./data/generated/restrooms');
const {
  checkDataVersion,
  initCloud,
} = require('./utils/cloud-service');

App({
  globalData: {
    env: 'metro-restroom-d4goyb1fq3f9df0b3',
    cloudReady: false,
    dataVersionStatus: null,
    pendingCorrectionContext: null,
  },

  onLaunch: function () {
    this.globalData.cloudReady = initCloud();
    if (!this.globalData.cloudReady) return;

    checkDataVersion(restroomData.source.sha256)
      .then((status) => { this.globalData.dataVersionStatus = status; })
      .catch(() => { this.globalData.dataVersionStatus = { available: false }; });
  },
});
