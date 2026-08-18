const restroomData = require('../../data/generated/restrooms');
const {
  findCorrectionContext,
  getCorrectionOptions,
} = require('../../data/correction-options');
const { submitCorrection } = require('../../utils/cloud-service');
const {
  clearCorrectionDraft,
  getCorrectionDraft,
  saveCorrectionDraft,
} = require('../../utils/storage');

const ISSUE_OPTIONS = [
  { value: 'location', label: '厕所位置不准确' },
  { value: 'access', label: '闸内／闸外信息错误' },
  { value: 'description', label: '出口或位置描述错误' },
  { value: 'unavailable', label: '厕所已不存在／暂不可用' },
  { value: 'other', label: '其他' },
];

function createRequestId() {
  return `correction-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function networkType() {
  return new Promise((resolve) => {
    wx.getNetworkType({
      success: (result) => resolve(result.networkType || 'unknown'),
      fail: () => resolve('unknown'),
    });
  });
}

Page({
  data: {
    lineOptions: [],
    stationOptions: [],
    lineIndex: 0,
    stationIndex: 0,
    context: null,
    issueOptions: ISSUE_OPTIONS,
    issueType: '',
    description: '',
    descriptionCount: 0,
    contact: '',
    submitting: false,
    isSubmitDisabled: true,
    errorMessage: '',
  },

  onLoad() {
    const app = getApp();
    const incoming = app.globalData.pendingCorrectionContext;
    app.globalData.pendingCorrectionContext = null;
    const draft = incoming ? null : getCorrectionDraft();
    const requested = incoming || (draft && draft.context) || {};
    const lineOptions = getCorrectionOptions();
    let lineIndex = lineOptions.findIndex((line) => line.id === String(requested.lineId || ''));
    if (lineIndex < 0) lineIndex = 0;
    const stationOptions = lineOptions[lineIndex].stations;
    let stationIndex = stationOptions.findIndex((station) => (
      station.id === requested.stationId || station.restroomId === requested.restroomId
    ));
    if (stationIndex < 0) stationIndex = 0;
    const context = findCorrectionContext(
      lineOptions[lineIndex].id,
      stationOptions[stationIndex].id,
      requested.restroomId,
    );

    this._requestId = (draft && draft.requestId) || createRequestId();
    this._setFormData({
      lineOptions,
      stationOptions,
      lineIndex,
      stationIndex,
      context,
      issueType: (draft && draft.issueType) || '',
      description: (draft && draft.description) || '',
      contact: (draft && draft.contact) || '',
    });
  },

  _setFormData(patch) {
    const next = Object.assign({}, this.data, patch);
    const description = String(next.description || '').trim();
    this.setData(Object.assign({}, patch, {
      descriptionCount: String(next.description || '').length,
      isSubmitDisabled: next.submitting
        || !next.context
        || !next.issueType
        || description.length < 5
        || description.length > 300,
    }));
  },

  _setSelection(lineIndex, stationIndex) {
    const line = this.data.lineOptions[lineIndex];
    const stationOptions = line.stations;
    const safeStationIndex = Math.min(stationIndex, stationOptions.length - 1);
    const station = stationOptions[safeStationIndex];
    this._requestId = createRequestId();
    this._setFormData({
      lineIndex,
      stationIndex: safeStationIndex,
      stationOptions,
      context: findCorrectionContext(line.id, station.id, station.restroomId),
      errorMessage: '',
    });
  },

  onLineChange(event) {
    this._setSelection(Number(event.detail.value) || 0, 0);
  },

  onStationChange(event) {
    this._setSelection(this.data.lineIndex, Number(event.detail.value) || 0);
  },

  onIssueChange(event) {
    this._setFormData({ issueType: event.detail.value, errorMessage: '' });
  },

  onDescriptionInput(event) {
    this._setFormData({ description: event.detail.value, errorMessage: '' });
  },

  onContactInput(event) {
    this._setFormData({ contact: event.detail.value, errorMessage: '' });
  },

  _draft() {
    return {
      requestId: this._requestId,
      context: this.data.context,
      issueType: this.data.issueType,
      description: this.data.description,
      contact: this.data.contact,
    };
  },

  _saveFailedDraft(message) {
    saveCorrectionDraft(this._draft());
    this._setFormData({ submitting: false, errorMessage: message });
  },

  _payload() {
    const context = this.data.context;
    return {
      requestId: this._requestId,
      lineId: context.lineId,
      stationId: context.stationId,
      stationName: context.stationName,
      restroomId: context.restroomId,
      sourceSheet: context.sourceSheet,
      sourceRow: context.sourceRow,
      issueType: this.data.issueType,
      description: this.data.description.trim(),
      contact: this.data.contact.trim(),
      clientVersion: '开发版',
      dataVersion: restroomData.source.sha256,
    };
  },

  onSubmit() {
    if (this.data.isSubmitDisabled || this.data.submitting) return;
    this._setFormData({ submitting: true, errorMessage: '' });

    networkType().then((type) => {
      if (type === 'none') {
        this._saveFailedDraft('当前没有网络，反馈内容已保存在本地，可联网后重试。');
        return null;
      }
      return submitCorrection(this._payload());
    }).then((result) => {
      if (!result) return;
      clearCorrectionDraft();
      wx.showModal({
        title: '反馈已提交',
        content: '审核通过后会更新数据。感谢你的帮助。',
        showCancel: false,
        success: () => {
          if (getCurrentPages().length > 1) wx.navigateBack();
          else wx.switchTab({ url: '/pages/profile/index' });
        },
      });
    }).catch((error) => {
      const message = error && error.code === 'RATE_LIMITED'
        ? '提交太频繁，请稍后再试。'
        : '提交失败，反馈内容已保存在本地，请稍后重试。';
      this._saveFailedDraft(message);
    });
  },
});
