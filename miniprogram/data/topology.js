/**
 * 上海地铁首版拓扑。
 *
 * `stationNames` 是用于建边的规范站名及 Excel 行序；导入 Excel 时通过
 * `normalizeStationName` 处理原始名、旧名和错别字。普通线可直接按相邻站建边，
 * 特殊线必须使用此文件中的 routes，禁止回退到工作表相邻行。
 */

function freezeStations(stationNames) {
  return Object.freeze(stationNames.slice());
}

function createStationStatusByName(stationNames, statusOverrides) {
  const stationStatusByName = {};
  stationNames.forEach((stationName) => {
    stationStatusByName[stationName] = 'active';
  });

  return Object.freeze(Object.assign(stationStatusByName, statusOverrides));
}

function linearLine(id, color, stationNames, options) {
  const settings = options || {};
  const forwardTerminal = stationNames[stationNames.length - 1];
  const reverseTerminal = stationNames[0];

  return Object.freeze({
    id,
    name: `${id}号线`,
    color,
    type: 'linear',
    defaultRouteId: `l${id}-main`,
    defaultDirection: settings.defaultDirection || 'forward',
    directions: Object.freeze({
      forward: Object.freeze({ id: 'forward', label: `往${forwardTerminal}` }),
      reverse: Object.freeze({ id: 'reverse', label: `往${reverseTerminal}` }),
    }),
    routes: Object.freeze([
      Object.freeze({
        id: `l${id}-main`,
        stationNames: freezeStations(stationNames),
        stationStatusByName: createStationStatusByName(stationNames, settings.stationStatusByName),
        directionIds: Object.freeze(['forward', 'reverse']),
      }),
    ]),
  });
}

const LINES = Object.freeze({
  '1': linearLine('1', '#E3002B', [
    '富锦路', '友谊西路', '宝安公路', '共富新村', '呼兰路', '通河新村', '共康路',
    '彭浦新村', '汶水路', '上海马戏城', '延长路', '中山北路', '上海火车站', '汉中路',
    '新闸路', '人民广场', '一大会址・黄陂南路', '陕西南路', '常熟路', '衡山路',
    '徐家汇', '上海体育馆', '漕宝路', '上海南站', '锦江乐园', '莲花路', '外环路', '莘庄',
  ]),
  '2': linearLine('2', '#8CC220', [
    '浦东国际机场', '海天三路', '远东大道', '凌空路', '川沙', '华夏东路', '创新中路',
    '唐镇', '广兰路', '金科路', '张江高科', '龙阳路', '世纪公园', '上海科技馆',
    '世纪大道', '东昌路', '陆家嘴', '南京东路', '人民广场', '南京西路', '静安寺',
    '江苏路', '中山公园', '娄山关路', '威宁路', '北新泾', '淞虹路', '虹桥 2 号航站楼',
    '虹桥火车站', '徐泾东（国家会展中心）',
  ], { defaultDirection: 'reverse' }),
  '3': linearLine('3', '#FFD100', [
    '江杨北路', '铁力路', '友谊路', '宝杨路', '水产路', '淞滨路', '张华浜', '淞发路',
    '长江南路', '殷高西路', '江湾镇', '大柏树', '赤峰路', '虹口足球场', '东宝兴路',
    '宝山路', '上海火车站', '中潭路', '镇坪路', '曹杨路', '金沙江路', '中山公园',
    '延安西路', '虹桥路', '宜山路', '漕溪路', '龙漕路', '石龙路', '上海南站',
  ]),
  '4': Object.freeze({
    id: '4',
    name: '4号线',
    color: '#5A3A8D',
    type: 'loop',
    defaultRouteId: 'l4-loop',
    defaultDirection: 'outer',
    directions: Object.freeze({
      outer: Object.freeze({ id: 'outer', label: '外圈' }),
      inner: Object.freeze({ id: 'inner', label: '内圈' }),
    }),
    routes: Object.freeze([
      Object.freeze({
        id: 'l4-loop',
        closed: true,
        closedEdge: Object.freeze(['上海体育馆', '宜山路']),
        directionIds: Object.freeze(['outer', 'inner']),
        stationNames: freezeStations([
          '宜山路', '虹桥路', '延安西路', '中山公园', '金沙江路', '曹杨路', '镇坪路',
          '中潭路', '上海火车站', '宝山路', '海伦路', '临平路', '大连路', '杨树浦路',
          '浦东大道', '世纪大道', '浦电路', '蓝村路', '塘桥', '南浦大桥', '西藏南路',
          '鲁班路', '大木桥路', '东安路', '上海体育场', '上海体育馆',
        ]),
      }),
    ]),
  }),
  '5': Object.freeze({
    id: '5',
    name: '5号线',
    color: '#A05EB5',
    type: 'branched',
    defaultRouteId: 'l5-fengxian',
    defaultDirection: 'to-fengxian-new-city',
    directions: Object.freeze({
      'to-fengxian-new-city': Object.freeze({ id: 'to-fengxian-new-city', label: '往奉贤新城' }),
      'to-minhang-development-zone': Object.freeze({ id: 'to-minhang-development-zone', label: '往闵行开发区' }),
      'to-xinzhuang': Object.freeze({ id: 'to-xinzhuang', label: '往莘庄' }),
    }),
    routes: Object.freeze([
      Object.freeze({
        id: 'l5-fengxian',
        terminalName: '奉贤新城',
        splitStationName: '东川路',
        directionIds: Object.freeze(['to-fengxian-new-city', 'to-xinzhuang']),
        stationNames: freezeStations([
          '莘庄', '春申路', '银都路', '颛桥', '北桥', '剑川路', '东川路', '江川路',
          '西渡', '萧塘', '奉浦大道', '环城东路', '望园路', '金海湖', '奉贤新城',
        ]),
      }),
      Object.freeze({
        id: 'l5-minhang-development-zone',
        terminalName: '闵行开发区',
        splitStationName: '东川路',
        directionIds: Object.freeze(['to-minhang-development-zone', 'to-xinzhuang']),
        stationNames: freezeStations([
          '莘庄', '春申路', '银都路', '颛桥', '北桥', '剑川路', '东川路', '金平路',
          '华宁路', '文井路', '闵行开发区',
        ]),
      }),
    ]),
  }),
  '6': linearLine('6', '#D10A75', [
    '港城路', '外高桥保税区北', '航津路', '外高桥保税区南', '洲海路', '五洲大道',
    '东靖路', '巨峰路', '五莲路', '博兴路', '金桥路', '云山路', '德平路', '北洋泾路',
    '民生路', '源深体育中心', '世纪大道', '浦电路', '蓝村路', '上海儿童医学中心',
    '临沂新村', '高科西路', '东明路', '高青路', '华夏西路', '上南路', '灵岩南路', '东方体育中心',
  ]),
  '7': linearLine('7', '#F38B00', [
    '美兰湖', '罗南新村', '潘广路', '刘行', '顾村公园', '祁华路', '上海大学', '南陈路',
    '上大路', '场中路', '大场镇', '行知路', '大华三路', '新村路', '岚皋路', '镇坪路',
    '长寿路', '昌平路', '静安寺', '常熟路', '肇嘉浜路', '东安路', '龙华中路', '后滩',
    '长清路', '耀华路', '云台路', '高科西路', '杨高南路', '锦绣路', '芳华路', '龙阳路', '花木路',
  ]),
  '8': linearLine('8', '#008C95', [
    '市光路', '嫩江路', '翔殷路', '黄兴公园', '延吉中路', '黄兴路', '江浦路', '鞍山新村',
    '四平路', '曲阳路', '虹口足球场', '西藏北路', '中兴路', '曲阜路', '人民广场', '大世界',
    '老西门', '陆家浜路', '西藏南路', '中华艺术宫', '耀华路', '成山路', '杨思', '东方体育中心',
    '凌兆新村', '芦恒路', '浦江镇', '江月路', '联航路', '沈杜公路',
  ]),
  '9': linearLine('9', '#69C7E2', [
    '曹路', '民雷路', '顾唐路', '金海路', '金吉路', '金桥', '台儿庄路', '蓝天路', '芳甸路',
    '杨高中路', '世纪大道', '商城路', '小南门', '陆家浜路', '马当路', '打浦桥', '嘉善路',
    '肇嘉浜路', '徐家汇', '宜山路', '桂林路', '漕河泾开发区', '合川路', '星中路', '七宝',
    '中春路', '九亭', '泗泾', '佘山', '洞泾', '松江大学城', '松江新城', '松江体育中心', '醉白池', '松江南站',
  ]),
  '10': Object.freeze({
    id: '10',
    name: '10号线',
    color: '#C8A5D6',
    type: 'branched',
    defaultRouteId: 'l10-hongqiao-railway-station',
    defaultDirection: 'to-hongqiao-railway-station',
    directions: Object.freeze({
      'to-hongqiao-railway-station': Object.freeze({ id: 'to-hongqiao-railway-station', label: '往虹桥火车站' }),
      'to-hangzhong-road': Object.freeze({ id: 'to-hangzhong-road', label: '往航中路' }),
      'to-jilong-road': Object.freeze({ id: 'to-jilong-road', label: '往基隆路' }),
    }),
    routes: Object.freeze([
      Object.freeze({
        id: 'l10-hongqiao-railway-station',
        terminalName: '虹桥火车站',
        splitStationName: '龙溪路',
        directionIds: Object.freeze(['to-hongqiao-railway-station', 'to-jilong-road']),
        stationNames: freezeStations([
          '基隆路', '港城路', '高桥站', '高桥西站', '双江路', '国帆路', '新江湾城', '殷高东路',
          '三门路', '江湾体育场', '五角场', '国权路', '同济大学', '四平路', '邮电新村', '海伦路',
          '四川北路', '天潼路', '南京东路', '豫园', '老西门', '一大会址・新天地', '陕西南路',
          '上海图书馆', '交通大学', '虹桥路', '宋园路', '伊犁路', '水城路', '龙溪路',
          '上海动物园', '虹桥1号航站楼', '虹桥2号航站楼', '虹桥火车站',
        ]),
      }),
      Object.freeze({
        id: 'l10-hangzhong-road',
        terminalName: '航中路',
        splitStationName: '龙溪路',
        directionIds: Object.freeze(['to-hangzhong-road', 'to-jilong-road']),
        stationNames: freezeStations([
          '基隆路', '港城路', '高桥站', '高桥西站', '双江路', '国帆路', '新江湾城', '殷高东路',
          '三门路', '江湾体育场', '五角场', '国权路', '同济大学', '四平路', '邮电新村', '海伦路',
          '四川北路', '天潼路', '南京东路', '豫园', '老西门', '一大会址・新天地', '陕西南路',
          '上海图书馆', '交通大学', '虹桥路', '宋园路', '伊犁路', '水城路', '龙溪路',
          '龙柏新村', '紫藤路', '航中路',
        ]),
      }),
    ]),
  }),
  '11': Object.freeze({
    id: '11',
    name: '11号线',
    color: '#8A6BBE',
    type: 'branched',
    defaultRouteId: 'l11-huaqiao-disney',
    defaultDirection: 'to-huaqiao',
    directions: Object.freeze({
      'to-huaqiao': Object.freeze({ id: 'to-huaqiao', label: '往花桥' }),
      'to-jiading-north': Object.freeze({ id: 'to-jiading-north', label: '往嘉定北' }),
      'to-disney': Object.freeze({ id: 'to-disney', label: '往迪士尼' }),
    }),
    routes: Object.freeze([
      Object.freeze({
        id: 'l11-huaqiao-disney',
        terminalName: '花桥',
        splitStationName: '嘉定新城',
        directionIds: Object.freeze(['to-huaqiao', 'to-disney']),
        stationNames: freezeStations([
          '花桥', '光明路', '兆丰路', '安亭', '上海汽车城', '昌吉东路', '上海赛车场', '嘉定新城',
          '马陆', '陈翔公路', '南翔', '桃浦新村', '武威路', '祁连山路', '李子园', '上海西站',
          '真如', '枫桥路', '曹杨路', '隆德路', '江苏路', '交通大学', '徐家汇', '上海游泳馆', '龙华',
          '云锦路', '东方体育中心', '三林', '三林东', '浦三路', '御桥', '罗山路', '秀沿路', '康新公路', '迪士尼',
        ]),
      }),
      Object.freeze({
        id: 'l11-jiading-north-disney',
        terminalName: '嘉定北',
        splitStationName: '嘉定新城',
        directionIds: Object.freeze(['to-jiading-north', 'to-disney']),
        stationNames: freezeStations([
          '嘉定北', '嘉定西站', '白银路', '嘉定新城', '马陆', '陈翔公路', '南翔', '桃浦新村', '武威路',
          '祁连山路', '李子园', '上海西站', '真如', '枫桥路', '曹杨路', '隆德路', '江苏路', '交通大学',
          '徐家汇', '上海游泳馆', '龙华', '云锦路', '东方体育中心', '三林', '三林东', '浦三路', '御桥',
          '罗山路', '秀沿路', '康新公路', '迪士尼',
        ]),
      }),
    ]),
  }),
  '12': linearLine('12', '#007A5E', [
    '七莘路', '虹莘路', '顾戴路', '东兰路', '虹梅路', '虹漕路', '桂林公园', '漕宝路', '龙漕路',
    '龙华', '龙华中路', '大木桥路', '嘉善路', '陕西南路', '南京西路', '汉中路', '曲阜路', '天潼路',
    '国际客运中心', '提篮桥', '大连路', '江浦公园', '宁国路', '隆昌路', '爱国路', '复兴岛', '东陆路',
    '巨峰路', '杨高北路', '金京路', '申江路', '金海路',
  ]),
  '13': linearLine('13', '#E69B2D', [
    '金运路', '金沙江西路', '丰庄', '祁连山南路', '真北路', '大渡河路', '金沙江路', '隆德路',
    '武宁路', '长寿路', '江宁路', '汉中路', '自然博物馆', '南京西路', '淮海中路', '一大会址・新天地',
    '马当路', '世博会博物馆', '世博大道', '长清路', '成山路', '东明路', '华鹏路', '下南路', '北蔡',
    '陈春路', '莲溪路', '华夏中路', '中科路', '学林路', '张江路',
  ]),
  '14': linearLine('14', '#6D7F2C', [
    '封浜', '乐秀路', '临洮路', '嘉怡路', '定边路', '真新新村', '真光路', '铜川路', '真如', '中宁路',
    '曹杨路', '武宁路', '武定路', '静安寺', '一大会址・黄陂南路', '大世界', '豫园', '陆家嘴', '浦东南路',
    '源深路', '昌邑路', '歇浦路', '云山路', '蓝天路', '黄杨路', '云顺路', '浦东足球场', '金粤路', '桂桥路',
  ]),
  '15': linearLine('15', '#B6A58D', [
    '顾村公园', '锦秋路', '丰翔路', '南大路', '祁安路', '古浪路', '武威东路', '上海西站', '铜川路',
    '梅岭北路', '大渡河路', '长风公园', '娄山关路', '红宝石路', '姚虹路', '吴中路', '桂林路', '桂林公园',
    '上海南站', '华东理工大学', '罗秀路', '朱梅路', '华泾西', '虹梅南路', '景西路', '曙建路', '双柏路',
    '元江路', '永德路', '紫竹高新园区',
  ]),
  '16': linearLine('16', '#77C8D3', [
    '龙阳路', '华夏中路', '罗山路', '周浦东', '鹤沙航城', '航头东', '新场', '野生动物园', '惠南',
    '惠南东', '书院', '临港大道', '滴水湖',
  ]),
  '17': linearLine('17', '#B5A265', [
    '虹桥火车站', '诸光路（国家会展中心）', '蟠龙路', '徐盈路', '徐泾北城', '嘉松中路', '赵巷', '汇金路',
    '青浦新城', '漕盈路', '淀山湖大道', '朱家角', '东方绿舟',
  ]),
  '18': linearLine('18', '#C99E73', [
    '康文路', '呼兰路', '爱辉路', '江杨南路', '长江西路', '通南路', '长江南路', '殷高路',
    '上海财经大学', '复旦大学', '国权路', '抚顺路', '江浦路', '江浦公园', '平凉路', '丹阳路', '昌邑路',
    '民生路', '杨高中路', '迎春路', '龙阳路', '芳芯路', '北中路', '莲溪路', '御桥', '康桥', '周浦',
    '繁荣路', '沈梅路', '鹤涛路', '下沙', '航头',
  ], {
    // 18号线二期于 2025-12-27 投运时，该站因周边配套未完成而暂不开通。
    stationStatusByName: { '江杨南路': 'unopened' },
  }),
  pujiang: Object.freeze({
    id: 'pujiang',
    name: '浦江线',
    color: '#9AB4D0',
    type: 'linear',
    defaultRouteId: 'pujiang-main',
    defaultDirection: 'forward',
    directions: Object.freeze({
      forward: Object.freeze({ id: 'forward', label: '往汇臻路' }),
      reverse: Object.freeze({ id: 'reverse', label: '往沈杜公路' }),
    }),
    routes: Object.freeze([
      Object.freeze({
        id: 'pujiang-main',
        stationNames: freezeStations(['沈杜公路', '三鲁公路', '闵瑞路', '浦航路', '东城一路', '汇臻路']),
        directionIds: Object.freeze(['forward', 'reverse']),
      }),
    ]),
  }),
});

const STATION_ALIASES = Object.freeze({
  global: Object.freeze({
    '虹桥 2 号航站楼': '虹桥2号航站楼',
    '嘉定北站': '嘉定北',
    '东路陆': '东陆路',
    '江杨南路-在建中': '江杨南路',
  }),
  byLine: Object.freeze({
    // Excel 仍保留原始行名；2024 线网图已将 4 号线浦电路更名为向城路。
    '4': Object.freeze({ '浦电路': '向城路' }),
    // 两座车站已分别改为相同站名，但现阶段空间分离，只能出站换乘。
    '2': Object.freeze({ '徐泾东（国家会展中心）': '国家会展中心（2号线）' }),
    '17': Object.freeze({ '诸光路（国家会展中心）': '国家会展中心（17号线）' }),
  }),
});

const TRANSFER_RULE = Object.freeze({
  type: 'same-canonical-station-name',
  description: '仅当归一化站名相同且不在排除表中，才生成候选换乘；候选关系仍需后续补充站内/出站属性。',
});

const TRANSFER_EXCLUSIONS = Object.freeze([
  Object.freeze({
    lineIds: Object.freeze(['4', '6']),
    stationNames: Object.freeze(['浦电路', '浦电路']),
    reason: '4号线浦电路（现向城路）与6号线浦电路不是同一换乘站，禁止按同名生成换乘。',
  }),
  Object.freeze({
    lineIds: Object.freeze(['2', '17']),
    stationNames: Object.freeze([
      '徐泾东（国家会展中心）',
      '诸光路（国家会展中心）',
      '国家会展中心',
    ]),
    reason: '2号线徐泾东与17号线诸光路虽同步更名为国家会展中心，现阶段仍是两座独立车站，仅可出站换乘。',
  }),
]);

const FORBIDDEN_ADJACENCIES = Object.freeze([
  Object.freeze({ lineId: '5', stationNames: Object.freeze(['奉贤新城', '金平路']) }),
  Object.freeze({ lineId: '10', stationNames: Object.freeze(['虹桥火车站', '龙柏新村']) }),
  Object.freeze({ lineId: '11', stationNames: Object.freeze(['上海赛车场', '嘉定北']) }),
]);

function normalizeStationName(stationName, lineId) {
  const rawName = String(stationName || '').trim();
  const withoutWhitespace = rawName.replace(/\s+/g, '');
  const globalAlias = STATION_ALIASES.global[rawName] || STATION_ALIASES.global[withoutWhitespace];
  const normalizedName = globalAlias || rawName;
  const lineAliases = STATION_ALIASES.byLine[String(lineId)] || {};

  return lineAliases[normalizedName] || lineAliases[withoutWhitespace] || normalizedName;
}

function isExcludedSameNameTransfer(lineIdA, stationNameA, lineIdB, stationNameB) {
  return TRANSFER_EXCLUSIONS.some((entry) => {
    const isSameLinePair = entry.lineIds.includes(String(lineIdA))
      && entry.lineIds.includes(String(lineIdB));
    const isSameStationPair = entry.stationNames.includes(stationNameA)
      && entry.stationNames.includes(stationNameB);

    return isSameLinePair && isSameStationPair;
  });
}

function canGenerateSameNameTransfer(lineIdA, stationNameA, lineIdB, stationNameB) {
  if (String(lineIdA) === String(lineIdB)) return false;
  if (isExcludedSameNameTransfer(lineIdA, stationNameA, lineIdB, stationNameB)) return false;

  return normalizeStationName(stationNameA, lineIdA)
    === normalizeStationName(stationNameB, lineIdB);
}

function hasUndirectedEdge(stationNames, firstStationName, secondStationName, closed) {
  for (let index = 0; index < stationNames.length - 1; index += 1) {
    const first = stationNames[index];
    const second = stationNames[index + 1];
    if ((first === firstStationName && second === secondStationName)
      || (first === secondStationName && second === firstStationName)) return true;
  }

  return Boolean(closed && (
    (stationNames[0] === firstStationName && stationNames[stationNames.length - 1] === secondStationName)
    || (stationNames[0] === secondStationName && stationNames[stationNames.length - 1] === firstStationName)
  ));
}

function validateTopology() {
  Object.keys(LINES).forEach((lineId) => {
    const line = LINES[lineId];
    const defaultRoute = line.routes.find((route) => route.id === line.defaultRouteId);
    if (!defaultRoute) {
      throw new Error(`${line.name}缺少有效的默认路由。`);
    }
    if (!line.directions[line.defaultDirection] || !defaultRoute.directionIds.includes(line.defaultDirection)) {
      throw new Error(`${line.name}默认方向不属于默认路由。`);
    }
    line.routes.forEach((route) => {
      if (!Array.isArray(route.directionIds) || route.directionIds.length !== 2) {
        throw new Error(`${line.name}路由${route.id}必须声明两个合法方向。`);
      }
      route.directionIds.forEach((directionId) => {
        if (!line.directions[directionId]) {
          throw new Error(`${line.name}路由${route.id}包含未知方向：${directionId}。`);
        }
      });
    });
  });

  const loopRoute = LINES['4'].routes[0];
  if (!loopRoute.closed || !hasUndirectedEdge(loopRoute.stationNames, '上海体育馆', '宜山路', true)) {
    throw new Error('4号线必须闭合上海体育馆—宜山路。');
  }

  FORBIDDEN_ADJACENCIES.forEach((forbidden) => {
    const containsForbiddenEdge = LINES[forbidden.lineId].routes.some((route) => hasUndirectedEdge(
      route.stationNames,
      forbidden.stationNames[0],
      forbidden.stationNames[1],
      route.closed,
    ));
    if (containsForbiddenEdge) {
      throw new Error(`${forbidden.lineId}号线存在禁止的假相邻边：${forbidden.stationNames.join('—')}。`);
    }
  });

  return true;
}

validateTopology();

module.exports = {
  LINES,
  STATION_ALIASES,
  TRANSFER_RULE,
  TRANSFER_EXCLUSIONS,
  FORBIDDEN_ADJACENCIES,
  normalizeStationName,
  canGenerateSameNameTransfer,
  validateTopology,
};
