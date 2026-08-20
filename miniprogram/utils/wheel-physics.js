const FOCUS_SCALE_X = 0.065;
const FOCUS_SCALE_Y = 0.055;
const FOCUS_GAP_RATIO = 0.11;
const MAX_VELOCITY_SLOTS_PER_SECOND = 22;
const POSITION_EPSILON = 0.000001;

function clamp(value, min, max) {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

function getFocusStrength(distance) {
  'worklet';
  const proximity = clamp(1 - Math.abs(distance), 0, 1);
  return 0.5 - (0.5 * Math.cos(Math.PI * proximity));
}

function getCardMotion(distance, slotHeight) {
  'worklet';
  const absoluteDistance = Math.abs(distance);
  const normalizedDistance = clamp(absoluteDistance, 0, 1);
  const focus = getFocusStrength(distance);
  const gapProgress = normalizedDistance * normalizedDistance * (3 - (2 * normalizedDistance));
  const direction = distance < 0 ? -1 : (distance > 0 ? 1 : 0);
  const gap = Math.max(0, Number(slotHeight) || 0) * FOCUS_GAP_RATIO;

  return {
    focus,
    scaleX: 1 + (FOCUS_SCALE_X * focus),
    scaleY: 1 + (FOCUS_SCALE_Y * focus),
    translateY: direction * gap * gapProgress,
  };
}

function getDetentIndex(currentDetent, position, maxIndex) {
  'worklet';
  const maximum = Math.max(0, Number(maxIndex) || 0);
  const current = clamp(Math.round(Number(currentDetent) || 0), 0, maximum);
  const nextPosition = clamp(Number(position) || 0, 0, maximum);

  if (nextPosition > current) {
    return clamp(Math.floor(nextPosition + POSITION_EPSILON), current, maximum);
  }
  if (nextPosition < current) {
    return clamp(Math.ceil(nextPosition - POSITION_EPSILON), 0, current);
  }
  return current;
}

function clampWheelVelocity(velocity, slotHeight) {
  'worklet';
  const maximum = Math.max(1, Number(slotHeight) || 1) * MAX_VELOCITY_SLOTS_PER_SECOND;
  return clamp(Number(velocity) || 0, -maximum, maximum);
}

module.exports = {
  clamp,
  getCardMotion,
  getDetentIndex,
  getFocusStrength,
  clampWheelVelocity,
};
