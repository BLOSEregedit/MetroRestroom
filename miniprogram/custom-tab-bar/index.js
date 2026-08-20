Component({
  data: {
    selected: 0,
    tabs: [
      {
        text: "首页",
        pagePath: "/pages/index/index",
        iconPath: "/images/icons/home.png",
        selectedIconPath: "/images/icons/home-active.png",
      },
      {
        text: "我的",
        pagePath: "/pages/profile/index",
        iconPath: "/images/icons/usercenter.png",
        selectedIconPath: "/images/icons/usercenter-active.png",
      },
    ],
  },
  methods: {
    onSwitchTab(e) {
      const { index, pagePath } = e.currentTarget.dataset;
      if (index === this.data.selected) return;
      this.setData({ selected: index });
      wx.switchTab({ url: pagePath });
    },
  },
});
