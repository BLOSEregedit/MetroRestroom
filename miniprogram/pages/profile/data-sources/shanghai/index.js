let segmentTimeData = {};
try {
  segmentTimeData = require('../../../../data/generated/segment-times');
} catch (error) {
  segmentTimeData = {};
}

function checkedDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : '持续核对中';
}

function returnToSources() {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  if (pages.length > 1 && typeof wx.navigateBack === 'function') {
    wx.navigateBack({ delta: 1 });
    return;
  }
  wx.navigateTo({ url: '/pages/profile/data-sources/index' });
}

Page({
  data: {
    checkedDate: checkedDate(segmentTimeData.metadata && segmentTimeData.metadata.checkedAt),
    sourceLinks: [
      {
        title: '上海地铁线路与站点',
        publisher: '上海地铁官方公开数据',
        url: 'https://m.shmetro.com/interface/metromap/metromap.aspx?func=lineStations&line=1',
      },
      {
        title: '首末班车与行车间隔',
        publisher: '上海地铁官方乘客服务',
        url: 'https://service.shmetro.com/hcskb/index.htm',
      },
      {
        title: '预计下车时间与路径时分',
        publisher: '上海地铁官方乘客服务',
        url: 'https://service.shmetro.com/jhndcx/index.htm',
      },
      {
        title: '轨道交通运营服务规范',
        publisher: '上海市交通委员会',
        url: 'https://jtw.sh.gov.cn/2025ngfxwj/20250122/45e2177ec30648c696ad6f5b5b9739a1.html',
      },
      {
        title: '站点与入口坐标许可',
        publisher: 'OpenStreetMap contributors · ODbL 1.0',
        url: 'https://www.openstreetmap.org/copyright',
      },
    ],
  },
  onCopySource(event) {
    const index = Number(event.currentTarget.dataset.index);
    const source = this.data.sourceLinks[index];
    if (!source) return;
    wx.setClipboardData({
      data: source.url,
      success() {
        wx.showToast({ title: '来源链接已复制', icon: 'none' });
      },
    });
  },
  onBack() {
    returnToSources();
  },
});
