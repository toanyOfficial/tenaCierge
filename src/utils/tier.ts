const tierLabelMap: Record<number, string> = {
  1: '블랙',
  2: '대기',
  3: '보류',
  4: '비기너',
  5: '숙련자',
  6: '전문가',
  7: '버틀러',
  99: '관리자'
};

const tierApplyWindows: Record<number, string> = {
  7: '15:00',
  6: '15:00',
  5: '16:00',
  4: '16:30',
  3: '16:30',
  2: '16:30',
  1: '16:30',
  99: '15:00'
};

const tierApplyHorizons: Record<number, number> = {
  7: 7,
  6: 5,
  5: 3,
  4: 1,
  3: 1,
  2: 1,
  1: 0,
  99: 7
};

const DEFAULT_APPLY_TIME = '16:30';
const DEFAULT_HORIZON = 1;

export function getTierLabel(tier: number | null) {
  if (typeof tier === 'number' && tierLabelMap[tier]) {
    return tierLabelMap[tier];
  }

  return '미정';
}

export function getApplyStartLabel(tier: number | null) {
  if (typeof tier === 'number' && tierApplyWindows[tier]) {
    return tierApplyWindows[tier];
  }

  return DEFAULT_APPLY_TIME;
}

export function getApplyHorizonDays(tier: number | null) {
  if (typeof tier === 'number' && typeof tierApplyHorizons[tier] === 'number') {
    return tierApplyHorizons[tier];
  }

  return DEFAULT_HORIZON;
}

export function getTierLabelMap() {
  return { ...tierLabelMap };
}
