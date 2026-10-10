import type { SpellId } from "./spells";

interface P {
  x: number;
  y: number;
  /** 깊이 (작을수록 카메라에 가까움, x/y와 같은 px 단위) */
  z: number;
}

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
// 손가락이 카메라 쪽으로 굽으면 화면상으로는 짧아 보이므로 손가락 상태는 깊이까지 넣어서 본다
const dist3 = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export type FingerState = "out" | "folded" | "unsure";

export interface HandAnalysis {
  gesture: SpellId | null;
  /** 검지, 중지, 약지, 새끼 */
  fingers: FingerState[];
  thumbOut: boolean;
  /** 손끝이 손가락 뿌리보다 카메라에 얼마나 가까운지 (손 크기 대비). 양수면 손바닥 쪽으로 굽힘 */
  tipsCloser: number;
  /** 네 손끝이 손가락 뿌리 대비 손목에서 얼마나 먼지 평균. 작을수록 손바닥 안으로 깊이 말림 (주먹 < 0.92, 고양이 손 ≥ 1.0) */
  curl: number;
}

const CAT_CURL = 1.0;
const FIST_CURL = 0.92;

/**
 * 손 랜드마크 21개(화면 px 좌표)로 손동작을 판정한다.
 * 손가락마다 펴짐 / 접힘 / 애매함 으로 나누고, 등록된 손동작과 정확히 맞을 때만 인식한다.
 * 주먹과 고양이 손은 손가락 하나로는 구분이 애매하므로 손 전체의 말림 정도(curl)로 나누고,
 * 둘 사이 애매한 구간은 아무것도 아닌 것으로 본다.
 */
export function analyzeHand(lm: P[]): HandAnalysis {
  const wrist = lm[0];
  const size = dist(wrist, lm[9]) || 1;

  const finger = (mcp: number): FingerState => {
    const [pip, dip, tip] = [mcp + 1, mcp + 2, mcp + 3];
    const path = dist3(lm[mcp], lm[pip]) + dist3(lm[pip], lm[dip]) + dist3(lm[dip], lm[tip]);
    // 1에 가까울수록 곧게 편 손가락
    const straight = dist3(lm[mcp], lm[tip]) / (path || 1);
    const reach = dist3(wrist, lm[tip]);
    if (straight > 0.85 && reach > dist3(wrist, lm[pip]) * 1.1) return "out";
    if (straight < 0.8 || reach < dist3(wrist, lm[pip]) * 0.98) return "folded";
    return "unsure";
  };
  const fingers = [finger(5), finger(9), finger(13), finger(17)];

  // 엄지: 손바닥 중심(9)에서 충분히 멀고, 끝마디가 첫마디보다 바깥에 있으면 편 것
  const thumbOut = dist(lm[4], lm[9]) > size * 0.75 && dist(lm[4], lm[17]) > dist(lm[3], lm[17]);
  const tipsCloser = [5, 9, 13, 17].reduce((sum, mcp) => sum + (lm[mcp].z - lm[mcp + 3].z), 0) / 4 / size;
  const curl = [5, 9, 13, 17].reduce((sum, mcp) => sum + dist3(wrist, lm[mcp + 3]) / (dist3(wrist, lm[mcp]) || 1), 0) / 4;

  const analysis = { fingers, thumbOut, tipsCloser, curl };
  return { gesture: pickGesture(lm, analysis, size), ...analysis };
}

function pickGesture(lm: P[], { fingers, thumbOut, tipsCloser, curl }: Omit<HandAnalysis, "gesture">, size: number): SpellId | null {
  const is = (...want: FingerState[]) => fingers.every((f, i) => f === want[i]);
  const [i, m, r, pk] = fingers;

  if (is("out", "out", "out", "out")) return thumbOut ? "Open_Palm" : null;
  if (is("out", "folded", "folded", "out")) return thumbOut ? "ILoveYou" : null;
  // 전화기(🤙): 검지·중지·약지 접고 새끼 폄. 새끼는 짧아서 "애매함"으로 나오기 쉬우므로 접히지만 않았으면 인정,
  // 엄지는 옆으로 뻗으므로 검지 뿌리에서 멀리 떨어져 있기만 하면 인정
  if (i === "folded" && m === "folded" && r === "folded" && pk !== "folded") {
    const thumbAway = thumbOut || dist(lm[4], lm[5]) > size * 0.6;
    return thumbAway ? "Call_Me" : null;
  }
  if (is("out", "out", "folded", "folded")) return thumbOut ? null : "Victory";
  if (is("folded", "out", "folded", "folded")) return thumbOut ? null : "Middle_Finger";
  if (is("out", "folded", "folded", "folded")) {
    if (thumbOut) return null;
    return lm[8].y < lm[5].y - size * 0.4 ? "Pointing_Up" : null;
  }

  // 여기부터는 네 손가락이 모두 굽은 손: 말림 정도로 고양이 손 / 주먹 계열을 나눈다
  if (fingers.includes("out") || fingers.filter((f) => f === "folded").length < 3) return null;
  if (curl >= CAT_CURL) {
    // 고양이 손: 손바닥이 카메라를 향해 손끝이 카메라 쪽으로 굽어 있어야 함
    return tipsCloser > 0.05 ? "Cat_Paw" : null;
  }
  if (curl > FIST_CURL || !is("folded", "folded", "folded", "folded")) return null;

  if (!thumbOut) return "Closed_Fist";
  // 엄지가 세로로 서 있을 때만 엄지 위/아래
  const tx = lm[4].x - lm[2].x;
  const ty = lm[4].y - lm[2].y;
  if (Math.abs(ty) < Math.abs(tx) * 1.5) return null;
  const knuckleTop = Math.min(lm[5].y, lm[9].y, lm[13].y, lm[17].y);
  const knuckleBottom = Math.max(lm[5].y, lm[9].y, lm[13].y, lm[17].y);
  if (lm[4].y < knuckleTop - size * 0.4) return "Thumb_Up";
  if (lm[4].y > knuckleBottom + size * 0.4) return "Thumb_Down";
  return null;
}
