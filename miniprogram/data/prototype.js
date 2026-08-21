const { estimateEta } = require("../utils/eta");
const { getPreferences } = require("../utils/storage");

const SYSTEM_ORIGIN_STATION_ID = "l2-renmin-square";

// 交互原型专用数据，仅用于验证页面状态，不作为正式卫生间数据。
const STATIONS = Object.freeze({
  "l2-jingan-temple": {
    id: "l2-jingan-temple",
    lineId: "2",
    name: "静安寺",
    transfers: [],
    restrooms: [
      {
        id: "toilet-l2-jingan-platform",
        location: "往浦东国际机场方向站台车头",
        access: "闸内",
        facility: "卫生间",
      },
    ],
  },
  "l2-west-nanjing-road": {
    id: "l2-west-nanjing-road",
    lineId: "2",
    name: "南京西路",
    transfers: [],
    restrooms: [
      {
        id: "toilet-l2-west-nanjing-platform",
        location: "往浦东国际机场方向站台车头",
        access: "闸内",
        facility: "卫生间",
      },
    ],
  },
  "l2-renmin-square": {
    id: "l2-renmin-square",
    lineId: "2",
    name: "人民广场",
    transfers: [
      { lineId: "8", stationId: "l8-renmin-square" },
    ],
    restrooms: [
      {
        id: "toilet-l2-renmin-square-platform",
        location: "2号线往浦东国际机场方向站台车尾",
        access: "闸内",
        facility: "卫生间",
      },
      {
        id: "toilet-l1-renmin-square-platform",
        location: "1号线往莘庄方向站台车头",
        access: "闸内",
        facility: "卫生间",
        transferCount: 1,
      },
      {
        id: "toilet-l8-renmin-square-platform",
        location: "8号线往沈杜公路方向站台车头",
        access: "闸内",
        facility: "卫生间",
        transferCount: 1,
      },
    ],
  },
  "l2-east-nanjing-road": {
    id: "l2-east-nanjing-road",
    lineId: "2",
    name: "南京东路",
    transfers: [],
    restrooms: [
      {
        id: "toilet-l2-east-nanjing-platform",
        location: "往浦东国际机场方向站台车尾",
        access: "闸内",
        facility: "卫生间",
      },
    ],
  },
  "l2-lujiazui": {
    id: "l2-lujiazui",
    lineId: "2",
    name: "陆家嘴",
    transfers: [],
    restrooms: [
      {
        id: "toilet-l2-lujiazui-platform",
        location: "往浦东国际机场方向站台车头",
        access: "闸内",
        facility: "卫生间",
      },
      {
        id: "toilet-l14-lujiazui-platform",
        location: "14号线往桂桥路方向站台车尾",
        access: "闸内",
        facility: "卫生间",
        transferCount: 1,
      },
    ],
  },
  "l2-dongchang-road": {
    id: "l2-dongchang-road",
    lineId: "2",
    name: "东昌路",
    transfers: [],
    restrooms: [],
    dataState: "none",
  },
  "l2-century-avenue": {
    id: "l2-century-avenue",
    lineId: "2",
    name: "世纪大道",
    transfers: [],
    restrooms: [
      {
        id: "toilet-l2-century-avenue-hall",
        location: "6号线往东方体育中心方向车尾附近",
        access: "闸内",
        facility: "卫生间",
        transferCount: 1,
      },
    ],
  },
  "l8-qufu-road": {
    id: "l8-qufu-road",
    lineId: "8",
    name: "曲阜路",
    transfers: [],
    restrooms: [
      {
        id: "toilet-l8-qufu-road-hall",
        location: "站厅近3号口",
        access: "闸外",
        facility: "卫生间",
      },
    ],
  },
  "l8-renmin-square": {
    id: "l8-renmin-square",
    lineId: "8",
    name: "人民广场",
    transfers: [
      { lineId: "2", stationId: "l2-renmin-square" },
    ],
    restrooms: [
      {
        id: "toilet-l8-renmin-square-platform",
        location: "8号线往沈杜公路方向站台车头",
        access: "闸内",
        facility: "卫生间",
      },
    ],
  },
  "l8-dashijie": {
    id: "l8-dashijie",
    lineId: "8",
    name: "大世界",
    transfers: [],
    restrooms: [],
    dataState: "unavailable",
  },
  "l8-laoximen": {
    id: "l8-laoximen",
    lineId: "8",
    name: "老西门",
    transfers: [],
    restrooms: [
      {
        id: "toilet-l8-laoximen-platform",
        location: "往沈杜公路方向站台车头",
        access: "闸内",
        facility: "卫生间",
      },
    ],
  },
});

const LINE_2_ROUTE = Object.freeze({
  id: "l2-main",
  name: "徐泾东—浦东国际机场",
  stationIds: Object.freeze([
    "l2-jingan-temple",
    "l2-west-nanjing-road",
    "l2-renmin-square",
    "l2-east-nanjing-road",
    "l2-lujiazui",
    "l2-dongchang-road",
    "l2-century-avenue",
  ]),
});

const LINE_8_ROUTE = Object.freeze({
  id: "l8-main",
  name: "市光路—沈杜公路",
  stationIds: Object.freeze([
    "l8-qufu-road",
    "l8-renmin-square",
    "l8-dashijie",
    "l8-laoximen",
  ]),
});

const LINES = Object.freeze({
  "2": Object.freeze({
    id: "2",
    name: "2号线",
    color: "#8CC220",
    type: "linear",
    defaultRouteId: LINE_2_ROUTE.id,
    defaultDirection: "to-pudong-airport",
    defaultViewStationId: "l2-renmin-square",
    routes: Object.freeze({ [LINE_2_ROUTE.id]: LINE_2_ROUTE }),
    directions: Object.freeze({
      "to-pudong-airport": Object.freeze({
        id: "to-pudong-airport",
        label: "往浦东国际机场",
        oppositeLabel: "往徐泾东",
        reverseRoute: false,
      }),
      "to-xujing-east": Object.freeze({
        id: "to-xujing-east",
        label: "往徐泾东",
        oppositeLabel: "往浦东国际机场",
        reverseRoute: true,
      }),
    }),
  }),
  "8": Object.freeze({
    id: "8",
    name: "8号线",
    color: "#008C95",
    type: "linear",
    defaultRouteId: LINE_8_ROUTE.id,
    defaultDirection: "to-shendu-highway",
    defaultViewStationId: "l8-renmin-square",
    routes: Object.freeze({ [LINE_8_ROUTE.id]: LINE_8_ROUTE }),
    directions: Object.freeze({
      "to-shendu-highway": Object.freeze({
        id: "to-shendu-highway",
        label: "往沈杜公路",
        oppositeLabel: "往市光路",
        reverseRoute: false,
      }),
      "to-shiguang-road": Object.freeze({
        id: "to-shiguang-road",
        label: "往市光路",
        oppositeLabel: "往沈杜公路",
        reverseRoute: true,
      }),
    }),
  }),
});

function getLineOptions() {
  return Object.keys(LINES).map((lineId) => {
    const line = LINES[lineId];
    return {
      id: line.id,
      name: line.name,
      color: line.color,
      type: line.type,
      defaultRouteId: line.defaultRouteId,
      directions: Object.keys(line.directions).map((directionId) => ({
        id: directionId,
        label: line.directions[directionId].label,
      })),
    };
  });
}

function findStationRoute(stationId) {
  const lineIds = Object.keys(LINES);

  for (let lineIndex = 0; lineIndex < lineIds.length; lineIndex += 1) {
    const line = LINES[lineIds[lineIndex]];
    const routeIds = Object.keys(line.routes);

    for (let routeIndex = 0; routeIndex < routeIds.length; routeIndex += 1) {
      const route = line.routes[routeIds[routeIndex]];
      if (route.stationIds.includes(stationId)) {
        return { line, route };
      }
    }
  }

  return null;
}

function findTransferToRoute(station, orderedStationIds) {
  return (station && station.transfers || []).find(
    (transfer) => orderedStationIds.includes(transfer.stationId),
  );
}

function resolveOriginContext(originStationId, orderedStationIds) {
  const directIndex = orderedStationIds.indexOf(originStationId);
  if (directIndex >= 0) {
    return {
      currentIndex: directIndex,
      approachSegmentCount: 0,
      transferCount: 0,
    };
  }

  const originStation = STATIONS[originStationId];
  const directTransfer = findTransferToRoute(originStation, orderedStationIds);
  if (directTransfer) {
    return {
      currentIndex: orderedStationIds.indexOf(directTransfer.stationId),
      approachSegmentCount: 0,
      transferCount: 1,
    };
  }

  const originRouteContext = findStationRoute(originStationId);
  if (originRouteContext) {
    const originIndex = originRouteContext.route.stationIds.indexOf(originStationId);
    let bestTransfer = null;

    originRouteContext.route.stationIds.forEach((stationId, stationIndex) => {
      const transfer = findTransferToRoute(STATIONS[stationId], orderedStationIds);
      if (!transfer) {
        return;
      }

      const segmentCount = Math.abs(stationIndex - originIndex);
      if (!bestTransfer || segmentCount < bestTransfer.approachSegmentCount) {
        bestTransfer = {
          currentIndex: orderedStationIds.indexOf(transfer.stationId),
          approachSegmentCount: segmentCount,
          transferCount: 1,
        };
      }
    });

    if (bestTransfer) {
      return bestTransfer;
    }
  }

  return {
    currentIndex: 0,
    approachSegmentCount: 0,
    transferCount: 0,
  };
}

function resolveHomeInput(input) {
  const request = input || {};
  const line = LINES[request.lineId] || LINES["2"];
  const route = line.routes[request.routeId] || line.routes[line.defaultRouteId];
  const direction = line.directions[request.direction]
    || line.directions[line.defaultDirection];
  const originStationId = request.originStationId || SYSTEM_ORIGIN_STATION_ID;

  return { line, route, direction, originStationId };
}

function buildHomeView(input) {
  const resolved = resolveHomeInput(input);
  const orderedStationIds = resolved.direction.reverseRoute
    ? resolved.route.stationIds.slice().reverse()
    : resolved.route.stationIds.slice();
  const originContext = resolveOriginContext(
    resolved.originStationId,
    orderedStationIds,
  );
  const originStation = STATIONS[resolved.originStationId];
  const stations = orderedStationIds.map((stationId, index) => {
    const source = STATIONS[stationId];
    const dataState = source.dataState || "available";
    const segmentCount = originContext.approachSegmentCount
      + Math.abs(index - originContext.currentIndex);
    const isReverse = index < originContext.currentIndex;
    const restrooms = dataState === "available"
      ? source.restrooms.map((restroom) => {
        const eta = estimateEta({
          segmentCount,
          isReverse,
          transferCount: originContext.transferCount + (restroom.transferCount || 0),
          sameLineChangeCount: restroom.sameLineChangeCount,
          access: restroom.access,
        });

        return {
          id: restroom.id,
          location: restroom.location,
          access: restroom.access,
          facility: restroom.facility,
          etaLabel: eta.label,
          etaBreakdown: eta.breakdown,
        };
      })
      : [];

    return {
      id: source.id,
      name: source.name,
      etaLabel: restrooms.length ? restrooms[0].etaLabel : "",
      restrooms,
      transfers: source.transfers.map((transfer) => ({ ...transfer })),
      isReverse,
      hasRestroom: restrooms.length > 0,
      isOrigin: stationId === resolved.originStationId,
      dataState,
    };
  });

  return {
    line: {
      id: resolved.line.id,
      name: resolved.line.name,
      color: resolved.line.color,
      type: resolved.line.type,
      routeId: resolved.route.id,
      routeName: resolved.route.name,
    },
    direction: resolved.direction.id,
    directionLabel: resolved.direction.label,
    oppositeDirectionLabel: resolved.direction.oppositeLabel,
    originStationId: resolved.originStationId,
    originStationName: originStation ? originStation.name : resolved.originStationId,
    stations,
    currentIndex: originContext.currentIndex,
  };
}

function getInitialHomeState() {
  const preferences = getPreferences();
  const isManualOrigin = preferences.originMode === "manual";
  const originStationId = isManualOrigin
    ? preferences.originStationId || SYSTEM_ORIGIN_STATION_ID
    : SYSTEM_ORIGIN_STATION_ID;
  const view = buildHomeView({
    lineId: preferences.lineId,
    direction: preferences.direction,
    originStationId,
    routeId: preferences.routeId,
  });

  return {
    cityName: "上海",
    lineId: view.line.id,
    routeId: view.line.routeId,
    direction: view.direction,
    originStationId: view.originStationId,
    originMode: isManualOrigin ? "manual" : "smart",
    systemOriginStationId: SYSTEM_ORIGIN_STATION_ID,
    visibleStationId: view.stations[view.currentIndex].id,
    locationStatus: "notRequested",
    soundEnabled: preferences.soundEnabled !== false,
    vibrationEnabled: preferences.vibrationEnabled !== false,
  };
}

module.exports = {
  getInitialHomeState,
  getLineOptions,
  buildHomeView,
};
