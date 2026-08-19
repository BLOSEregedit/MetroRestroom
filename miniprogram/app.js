const { initCloud } = require('./utils/cloud-service');

App({
  globalData: {
    env: 'metro-restroom-d4goyb1fq3f9df0b3',
    cloudReady: false,
    activeSyncLineIds: ['2'],
    pendingCorrectionContext: null,
  },

  onLaunch: function () {
    this.globalData.cloudReady = initCloud();
  },
});
