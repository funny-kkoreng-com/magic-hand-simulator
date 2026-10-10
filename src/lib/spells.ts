export type SpellId =
  | "Open_Palm"
  | "Closed_Fist"
  | "Pointing_Up"
  | "Victory"
  | "Thumb_Up"
  | "Thumb_Down"
  | "ILoveYou"
  | "Middle_Finger"
  | "Cat_Paw"
  | "Call_Me";

export interface Spell {
  id: SpellId;
  hand: string;
  gestureName: string;
  spellName: string;
  icon: string;
  color: string;
  description: string;
  steps: string[];
}

// 가이드 패널에 이 순서대로 표시된다 (쉬운 동작 → 어려운 동작)
export const SPELLS: Spell[] = [
  {
    id: "Open_Palm",
    hand: "✋",
    gestureName: "손바닥 펴기",
    spellName: "화염구",
    icon: "🔥",
    color: "#ff7a1a",
    description: "손바닥 위에서 불꽃이 활활 타오릅니다.",
    steps: [
      "손바닥이 카메라를 향하게 듭니다.",
      "다섯 손가락을 모두 쭉 펴고 살짝 벌립니다.",
      "손을 움직이면 불꽃이 따라옵니다.",
    ],
  },
  {
    id: "Closed_Fist",
    hand: "✊",
    gestureName: "주먹 쥐기",
    spellName: "번개",
    icon: "⚡",
    color: "#7cc8ff",
    description: "주먹에서 사방으로 번개가 튑니다.",
    steps: [
      "손바닥을 편 상태에서 시작합니다.",
      "다섯 손가락을 모두 접어 주먹을 꽉 쥡니다.",
      "주먹 정면이 카메라를 향하도록 유지합니다.",
    ],
  },
  {
    id: "Pointing_Up",
    hand: "☝️",
    gestureName: "검지 들기",
    spellName: "빛의 궤적",
    icon: "✨",
    color: "#ffd84a",
    description: "검지 끝을 따라 별빛이 그려집니다.",
    steps: [
      "주먹을 쥔 상태에서 시작합니다.",
      "검지 하나만 위로 곧게 폅니다.",
      "허공에 그림을 그리듯 손가락을 움직여 보세요.",
    ],
  },
  {
    id: "Victory",
    hand: "✌️",
    gestureName: "브이(V)",
    spellName: "얼음 결정",
    icon: "❄️",
    color: "#8ff3ff",
    description: "두 손가락 사이에서 눈꽃이 흩날립니다.",
    steps: [
      "주먹을 쥔 상태에서 시작합니다.",
      "검지와 중지를 펴서 V자로 벌립니다.",
      "엄지·약지·새끼손가락은 접어 둡니다.",
    ],
  },
  {
    id: "Thumb_Up",
    hand: "👍",
    gestureName: "엄지 척",
    spellName: "치유의 빛",
    icon: "💚",
    color: "#5dff9a",
    description: "초록빛 치유의 고리가 퍼져 나갑니다.",
    steps: [
      "주먹을 쥔 상태에서 시작합니다.",
      "엄지만 위로 세웁니다.",
      "손등이 옆을 향하도록 살짝 돌려 주면 더 잘 인식됩니다.",
    ],
  },
  {
    id: "Thumb_Down",
    hand: "👎",
    gestureName: "엄지 아래",
    spellName: "암흑 소용돌이",
    icon: "🌀",
    color: "#b65cff",
    description: "보랏빛 어둠이 손으로 빨려 들어갑니다.",
    steps: [
      "엄지 척 자세를 만듭니다.",
      "손목을 돌려 엄지가 아래를 향하게 합니다.",
      "나머지 손가락은 주먹 쥔 상태를 유지합니다.",
    ],
  },
  {
    id: "ILoveYou",
    hand: "🤟",
    gestureName: "사랑해",
    spellName: "사랑의 마법",
    icon: "💖",
    color: "#ff5fa8",
    description: "하트가 둥실둥실 떠오릅니다.",
    steps: [
      "손바닥이 카메라를 향하게 듭니다.",
      "엄지, 검지, 새끼손가락을 폅니다.",
      "중지와 약지만 접어 줍니다.",
    ],
  },
  {
    id: "Middle_Finger",
    hand: "🖕",
    gestureName: "가운뎃손가락",
    spellName: "뻐큐 난사",
    icon: "🖕",
    color: "#ff3b3b",
    description: "손끝에서 🖕 이 쉴 새 없이 발사됩니다.",
    steps: [
      "주먹을 쥔 상태에서 시작합니다.",
      "가운뎃손가락 하나만 위로 폅니다.",
      "검지·약지·새끼손가락은 꼭 접어 둡니다.",
    ],
  },
  {
    id: "Cat_Paw",
    hand: "🐱",
    gestureName: "고양이 손",
    spellName: "냥냥 펀치",
    icon: "🐾",
    color: "#ffa6c1",
    description: "손이 말랑한 고양이 발로 변신합니다.",
    steps: [
      "손바닥이 카메라를 향하게 손을 앞으로 내밉니다.",
      "다섯 손가락을 고양이 발톱처럼 구부려 손톱 다섯 개가 다 보이게 합니다.",
      "주먹처럼 손바닥 안으로 꽉 말아 쥐지는 않습니다.",
    ],
  },
  {
    id: "Call_Me",
    hand: "🤙",
    gestureName: "전화기",
    spellName: "돈 뿌리기",
    icon: "💸",
    color: "#7dff6a",
    description: "손에서 지폐와 동전이 펑펑 뿌려집니다. FLEX!",
    steps: [
      "주먹을 쥔 상태에서 시작합니다.",
      "엄지와 새끼손가락만 쭉 펴서 전화기 모양을 만듭니다.",
      "검지·중지·약지는 접어 둡니다.",
    ],
  },
];

export const SPELL_MAP: Record<SpellId, Spell> = Object.fromEntries(
  SPELLS.map((s) => [s.id, s]),
) as Record<SpellId, Spell>;
