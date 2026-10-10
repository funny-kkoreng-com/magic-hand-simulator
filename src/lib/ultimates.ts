import type { HandState } from "./magicEngine";
import { SPELL_MAP, type SpellId } from "./spells";

export type UltimateId = "blackhole" | "thunder" | "meteor" | "infinite_void";

export interface Ultimate {
  id: UltimateId;
  name: string;
  icon: string;
  color: string;
  description: string;
  /** 결인 순서. 각 인은 두 손의 손동작 쌍 (좌우 구분 없음). 비어 있으면 결인 없이 마지막 자세만으로 발동 */
  seals: [SpellId, SpellId][];
  /** 한 손으로 쓰는 궁극기 (결인 없이 바로 차징) */
  oneHand?: boolean;
  /** 컷인 위에 작게 뜨는 부제 */
  subtitle?: string;
  chargeMs?: number;
  releaseMs?: number;
  /** 마지막 자세 설명 */
  finalStep: string;
  /** 차징이 끝난 뒤 손을 카메라 쪽으로 밀어야 발동 */
  push?: boolean;
  /** 차징 중 유지해야 하는 마지막 자세 */
  finalCheck: (hands: SeenHand[]) => boolean;
}

export interface SeenHand {
  gesture: SpellId | null;
  hand: HandState;
  /** 검지와 중지를 꼬았는지 (무량공처 결인) */
  crossed: boolean;
}

type TwoHands = [SeenHand, SeenHand];

const withTwo = (check: (h: TwoHands) => boolean) => (hands: SeenHand[]) =>
  hands.length >= 2 && check([hands[0], hands[1]]);

const palmDistance = ([a, b]: TwoHands) =>
  Math.hypot(a.hand.palm.x - b.hand.palm.x, a.hand.palm.y - b.hand.palm.y) / ((a.hand.size + b.hand.size) / 2);

const both = ([a, b]: TwoHands, g1: SpellId, g2: SpellId) =>
  (a.gesture === g1 && b.gesture === g2) || (a.gesture === g2 && b.gesture === g1);

export const ULTIMATES: Ultimate[] = [
  {
    id: "blackhole",
    name: "블랙홀",
    icon: "🌌",
    color: "#a66bff",
    description: "두 손 사이에 블랙홀이 열려 주변 빛을 모두 빨아들입니다.",
    seals: [
      ["Closed_Fist", "Closed_Fist"],
      ["Open_Palm", "Open_Palm"],
      ["Victory", "Victory"],
    ],
    finalStep: "두 손바닥을 펴서 공을 감싸듯 가까이 모으고 유지",
    finalCheck: withTwo((h) => both(h, "Open_Palm", "Open_Palm") && palmDistance(h) < 2.2),
  },
  {
    id: "thunder",
    name: "천둥 심판",
    icon: "⚡",
    color: "#9fd8ff",
    description: "하늘에서 거대한 벼락이 연달아 내리꽂힙니다.",
    seals: [
      ["Thumb_Down", "Thumb_Down"],
      ["Closed_Fist", "Open_Palm"],
      ["Victory", "Victory"],
      ["Closed_Fist", "Closed_Fist"],
    ],
    finalStep: "두 손 모두 검지를 하늘로 치켜들고 유지",
    finalCheck: withTwo((h) => both(h, "Pointing_Up", "Pointing_Up")),
  },
  {
    id: "meteor",
    name: "메테오",
    icon: "☄️",
    color: "#ff7a1a",
    description: "불타는 운석이 화면 가득 쏟아집니다.",
    seals: [
      ["Victory", "ILoveYou"],
      ["ILoveYou", "ILoveYou"],
      ["Closed_Fist", "Closed_Fist"],
      ["Thumb_Up", "Thumb_Up"],
    ],
    finalStep: "두 손바닥을 펴서 유지하다가, 게이지가 차면 카메라 쪽으로 쭉 밀기",
    push: true,
    finalCheck: withTwo((h) => both(h, "Open_Palm", "Open_Palm")),
  },
  {
    id: "infinite_void",
    name: "영역전개 · 무량공처",
    subtitle: "領域展開 · 無量空処",
    icon: "♾️",
    color: "#b9d8ff",
    description: "끝없는 정보가 쏟아지는 무한의 공간을 펼칩니다.",
    seals: [],
    oneHand: true,
    finalStep: "한 손을 들어 검지와 중지를 확실히 꼬고(교차), 엄지·약지·새끼는 접은 채 유지",
    chargeMs: 2500,
    releaseMs: 6500,
    finalCheck: (hands) => hands.some((h) => h.crossed),
  },
];

export const ULTIMATE_MAP: Record<UltimateId, Ultimate> = Object.fromEntries(
  ULTIMATES.map((u) => [u.id, u]),
) as Record<UltimateId, Ultimate>;

export const sealIcon = ([a, b]: [SpellId, SpellId]) => SPELL_MAP[a].hand + SPELL_MAP[b].hand;
export const sealLabel = ([a, b]: [SpellId, SpellId]) =>
  a === b ? `두 손 모두 ${SPELL_MAP[a].gestureName}` : `한 손 ${SPELL_MAP[a].gestureName} + 한 손 ${SPELL_MAP[b].gestureName}`;

/** 난이도 설정 */
export const ULT_RULES = {
  /** 한 인으로 인정받으려면 유지해야 하는 시간 */
  sealHoldMs: 300,
  /** 한 손 궁극기(무량공처) 결인을 이만큼 유지해야 차징이 시작됨 */
  oneHandHoldMs: 800,
  /** 다음 인까지 허용 시간 */
  sealGapMs: 2000,
  /** 엉뚱한 인을 이만큼 유지하면 실패 (그보다 짧으면 동작 전환 중으로 보고 무시) */
  wrongHoldMs: 600,
  /** 마지막 자세 유지 시간 */
  chargeMs: 2000,
  /** 마지막 자세에서 잠깐 풀려도 봐주는 시간 */
  chargeGraceMs: 400,
  /** 밀기 판정: 손 크기가 이 배율 이상 커지면 성공 */
  pushScale: 1.3,
  pushWindowMs: 1500,
  releaseMs: 3800,
  cooldownMs: 10000,
};

const pairKey = (a: SpellId, b: SpellId) => [a, b].sort().join("+");
const sealKey = (s: [SpellId, SpellId]) => pairKey(s[0], s[1]);

export type UltPhase = "idle" | "sealing" | "charging" | "pushing" | "release" | "cooldown";

export interface UltimateView {
  phase: UltPhase;
  id: UltimateId | null;
  sealsDone: number;
  /** sealing: 다음 인까지 남은 시간 비율 / charging: 게이지 / pushing: 남은 시간 비율 */
  progress: number;
  cooldownLeft: number;
}

export type UltEvent = { type: "seal" } | { type: "fail" } | { type: "ready" } | { type: "release"; id: UltimateId };

export class UltimateController {
  phase: UltPhase = "idle";
  ult: Ultimate | null = null;
  sealsDone = 0;
  charge = 0;
  /** 이펙트 중심 / 크기 (손이 사라져도 마지막 값 유지) */
  center = { x: 0, y: 0 };
  size = 100;
  phaseStart = 0;

  private lastSealAt = 0;
  private crossedSince = 0;
  private pair: string | null = null;
  private pairSince = 0;
  private recorded: string | null = null;
  private lastOk = 0;
  private baseSize = 0;
  private cooldownUntil = 0;

  private reset() {
    this.phase = "idle";
    this.ult = null;
    this.sealsDone = 0;
    this.charge = 0;
  }

  private fail(events: UltEvent[]) {
    if (this.sealsDone >= 2 || this.phase === "charging" || this.phase === "pushing") events.push({ type: "fail" });
    this.reset();
  }

  private tryStart(key: string, now: number, events: UltEvent[]) {
    const u = ULTIMATES.find((u) => u.seals.length > 0 && sealKey(u.seals[0]) === key);
    if (!u) return;
    this.phase = "sealing";
    this.ult = u;
    this.sealsDone = 1;
    this.lastSealAt = now;
    this.recorded = key;
    events.push({ type: "seal" });
  }

  update(now: number, dt: number, hands: SeenHand[]): UltEvent[] {
    const events: UltEvent[] = [];
    const two = hands.length >= 2 ? ([hands[0], hands[1]] as TwoHands) : null;

    if (two) {
      this.center = {
        x: (two[0].hand.palm.x + two[1].hand.palm.x) / 2,
        y: (two[0].hand.palm.y + two[1].hand.palm.y) / 2,
      };
      this.size = (two[0].hand.size + two[1].hand.size) / 2;
    }

    // 한 손 궁극기는 그 손을 중심으로
    const crossedHand = hands.find((h) => h.crossed);
    if (crossedHand && this.ult?.oneHand) {
      this.center = { ...crossedHand.hand.palm };
      this.size = crossedHand.hand.size;
    }

    if (this.phase === "release") {
      if (now - this.phaseStart >= (this.ult?.releaseMs ?? ULT_RULES.releaseMs)) {
        this.reset();
        this.phase = "cooldown";
        this.cooldownUntil = now + ULT_RULES.cooldownMs;
      }
      return events;
    }
    if (this.phase === "cooldown") {
      if (now < this.cooldownUntil) return events;
      this.reset();
      this.recorded = null;
    }

    const key = two && two[0].gesture && two[1].gesture ? pairKey(two[0].gesture, two[1].gesture) : null;
    if (key !== this.pair) {
      this.pair = key;
      this.pairSince = now;
    }
    const held = now - this.pairSince;

    if (!crossedHand) this.crossedSince = 0;
    else if (!this.crossedSince) this.crossedSince = now;

    if (this.phase === "idle") {
      // 한 손 궁극기: 결인 자세를 잠깐 유지하면 바로 차징 시작
      const oneHand = ULTIMATES.find((u) => u.oneHand);
      if (oneHand && crossedHand && now - this.crossedSince >= ULT_RULES.oneHandHoldMs) {
        this.ult = oneHand;
        this.center = { ...crossedHand.hand.palm };
        this.size = crossedHand.hand.size;
        this.phase = "charging";
        this.phaseStart = now;
        this.charge = 0;
        this.lastOk = now;
        events.push({ type: "ready" });
        return events;
      }
      if (key && key !== this.recorded && held >= ULT_RULES.sealHoldMs) this.tryStart(key, now, events);
      if (!key && held > ULT_RULES.sealGapMs) this.recorded = null;
      return events;
    }

    const ult = this.ult!;

    if (this.phase === "sealing") {
      const expected = sealKey(ult.seals[this.sealsDone]);
      if (key === expected && held >= ULT_RULES.sealHoldMs) {
        this.sealsDone++;
        this.lastSealAt = now;
        this.recorded = key;
        events.push({ type: "seal" });
        if (this.sealsDone === ult.seals.length) {
          this.phase = "charging";
          this.phaseStart = now;
          this.charge = 0;
          this.lastOk = now;
          events.push({ type: "ready" });
        }
      } else if (key && key !== this.recorded && key !== expected && held >= ULT_RULES.wrongHoldMs) {
        this.fail(events);
        this.tryStart(key, now, events);
      } else if (now - this.lastSealAt > ULT_RULES.sealGapMs) {
        this.fail(events);
      }
      return events;
    }

    if (this.phase === "charging") {
      const ok = ult.finalCheck(hands);
      if (ok) {
        this.lastOk = now;
        this.charge = Math.min(1, this.charge + (dt * 1000) / (ult.chargeMs ?? ULT_RULES.chargeMs));
      } else if (now - this.lastOk > (this.charge > 0 ? ULT_RULES.chargeGraceMs : ULT_RULES.sealGapMs)) {
        this.fail(events);
        return events;
      }
      if (this.charge >= 1) {
        if (ult.push) {
          this.phase = "pushing";
          this.phaseStart = now;
          this.baseSize = this.size;
        } else {
          this.release(now, events);
        }
      }
      return events;
    }

    if (this.phase === "pushing") {
      if (two && this.size >= this.baseSize * ULT_RULES.pushScale) this.release(now, events);
      else if (now - this.phaseStart > ULT_RULES.pushWindowMs) this.fail(events);
    }
    return events;
  }

  private release(now: number, events: UltEvent[]) {
    this.phase = "release";
    this.phaseStart = now;
    events.push({ type: "release", id: this.ult!.id });
  }

  view(now: number): UltimateView {
    let progress = 0;
    if (this.phase === "sealing") progress = Math.max(0, 1 - (now - this.lastSealAt) / ULT_RULES.sealGapMs);
    else if (this.phase === "charging") progress = this.charge;
    else if (this.phase === "pushing") progress = Math.max(0, 1 - (now - this.phaseStart) / ULT_RULES.pushWindowMs);
    return {
      phase: this.phase,
      id: this.ult?.id ?? null,
      sealsDone: this.sealsDone,
      progress,
      cooldownLeft: this.phase === "cooldown" ? Math.max(0, this.cooldownUntil - now) : 0,
    };
  }
}
