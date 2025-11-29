import type { CleaningWork } from '@/src/server/workTypes';
import { minutesToTimeString, parseTimeString } from '@/src/utils/time';

export type WorkFieldInput = {
  checkoutTime?: string;
  checkinTime?: string;
  blanketQty?: number;
  amenitiesQty?: number;
  cancelYn?: boolean;
  requirements?: string;
  cleaningYn?: boolean;
  conditionCheckYn?: boolean;
};

export type ValidationOptions = {
  canEditRequirements: boolean;
};

export type WorkMutationValues = {
  checkoutTime?: string;
  checkinTime?: string;
  blanketQty?: number;
  amenitiesQty?: number;
  cancelYn?: boolean;
  requirements?: string;
  cleaningYn?: boolean;
  conditionCheckYn?: boolean;
};

export type ValidationResult =
  | { ok: true; values: WorkMutationValues }
  | { ok: false; message: string };

export function validateWorkInput(
  input: WorkFieldInput,
  current: CleaningWork,
  options: ValidationOptions
): ValidationResult {
  const update: WorkMutationValues = {};

  if ('checkoutTime' in input) {
    if (typeof input.checkoutTime !== 'string') {
      return { ok: false, message: 'Checkout 시간 형식이 올바르지 않습니다.' };
    }

    const result = validateCheckout(input.checkoutTime, current.defaultCheckout);

    if (!result.ok) {
      return { ok: false, message: result.message };
    }

    update.checkoutTime = result.value;
  }

  if ('checkinTime' in input) {
    if (typeof input.checkinTime !== 'string') {
      return { ok: false, message: 'Checkin 시간 형식이 올바르지 않습니다.' };
    }

    const result = validateCheckin(input.checkinTime, current.defaultCheckin);

    if (!result.ok) {
      return { ok: false, message: result.message };
    }

    update.checkinTime = result.value;
  }

  if ('blanketQty' in input) {
    const result = validateQuantity(input.blanketQty, current.bedCount, current.bedCount + 1, 'Blanket');

    if (!result.ok) {
      return { ok: false, message: result.message };
    }

    update.blanketQty = result.value;
  }

  if ('amenitiesQty' in input) {
    const result = validateQuantity(input.amenitiesQty, current.bedCount, current.bedCount + 2, 'Amenities');

    if (!result.ok) {
      return { ok: false, message: result.message };
    }

    update.amenitiesQty = result.value;
  }

  if ('cancelYn' in input) {
    if (typeof input.cancelYn !== 'boolean') {
      return { ok: false, message: '취소 여부가 올바르지 않습니다.' };
    }

    update.cancelYn = input.cancelYn;
  }

  if ('cleaningYn' in input || 'conditionCheckYn' in input) {
    const cleaningYn = 'cleaningYn' in input ? Boolean(input.cleaningYn) : undefined;
    const conditionYn = 'conditionCheckYn' in input ? Boolean(input.conditionCheckYn) : undefined;

    if (cleaningYn === true && conditionYn === true) {
      return { ok: false, message: '청소 여부와 상태 확인 여부는 동시에 선택할 수 없습니다.' };
    }

    if (cleaningYn !== undefined) {
      update.cleaningYn = cleaningYn;
      if (conditionYn === undefined) {
        update.conditionCheckYn = !cleaningYn;
      }
    }

    if (conditionYn !== undefined) {
      update.conditionCheckYn = conditionYn;
      if (cleaningYn === undefined) {
        update.cleaningYn = !conditionYn;
      }
    }
  }

  if ('requirements' in input) {
    if (!options.canEditRequirements) {
      return { ok: false, message: '요청사항을 수정할 권한이 없습니다.' };
    }

    const text = typeof input.requirements === 'string' ? input.requirements.slice(0, 255) : '';
    update.requirements = text;
  }

  if (Object.keys(update).length === 0) {
    return { ok: false, message: '변경할 값이 없습니다.' };
  }

  return { ok: true, values: update };
}

function validateCheckout(value: string, base: string) {
  const minutes = parseTimeString(value);
  const baseMinutes = parseTimeString(base);

  if (minutes === null || baseMinutes === null) {
    return { ok: false, message: 'Checkout 시간 형식이 잘못되었습니다.' } as const;
  }

  if (minutes < baseMinutes || minutes > baseMinutes + 120) {
    return { ok: false, message: '레이트 체크아웃은 기준 대비 최대 2시간까지만 가능합니다.' } as const;
  }

  return { ok: true, value: toDbTime(minutesToTimeString(minutes)) } as const;
}

function validateCheckin(value: string, base: string) {
  const minutes = parseTimeString(value);
  const baseMinutes = parseTimeString(base);

  if (minutes === null || baseMinutes === null) {
    return { ok: false, message: 'Checkin 시간 형식이 잘못되었습니다.' } as const;
  }

  if (minutes < baseMinutes - 120 || minutes > baseMinutes) {
    return { ok: false, message: '얼리 체크인은 기준 대비 최대 2시간까지만 가능합니다.' } as const;
  }

  return { ok: true, value: toDbTime(minutesToTimeString(minutes)) } as const;
}

function validateQuantity(value: unknown, min: number, max: number, label: string) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return { ok: false, message: `${label} 수량 형식이 잘못되었습니다.` } as const;
  }

  const normalized = Math.trunc(value);

  if (normalized < min || normalized > max) {
    return { ok: false, message: `${label} 수량은 ${min}~${max} 사이여야 합니다.` } as const;
  }

  return { ok: true, value: normalized } as const;
}

function toDbTime(value: string) {
  return value.length === 5 ? `${value}:00` : value;
}
