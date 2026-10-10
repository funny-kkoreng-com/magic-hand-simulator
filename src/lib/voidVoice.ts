import { BASE_PATH } from "./basePath";

/**
 * 무량공처 음성 + 한자 타이밍 설정.
 *
 * public/sounds/ 의 음성 파일이 있으면 그 파일을 재생하고, 없으면 브라우저 일본어 음성 합성(TTS)으로 읽는다.
 * 직접 넣은 음성에 맞추려면 아래 VOID_CUES 의 초(발동 시점 기준)를 조정하면 된다.
 */
export const VOID_AUDIO_SRC = `${BASE_PATH}/sounds/muryo-kusho-made-with-Voicemod.mp3`;

export const VOID_CUES = {
  // 음성 파일(3.2초)의 음절 시작 지점에 맞춤: 료(0.2) 이키(0.45) 텐(0.75) 카이(0.95) / 무(1.75) 료(2.05) 쿠(2.45) 쇼(2.75)
  /** 領 域 展 開 각 글자가 뜨는 시각(초) */
  ryoiki: [0.2, 0.45, 0.75, 0.95],
  /** 無 量 空 処 각 글자가 뜨는 시각(초) */
  muryo: [1.75, 2.05, 2.45, 2.75],
  /** TTS를 쓸 때 "무료쿠쇼"를 말하기 시작하는 시각(초) */
  ttsSecondLine: 1.8,
};

export class VoidVoice {
  private audio: HTMLAudioElement | null = null;
  private hasFile = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** 카메라를 켤 때(사용자 클릭 직후) 미리 불러 둔다 */
  preload() {
    if (this.audio) return;
    const a = new Audio(VOID_AUDIO_SRC);
    a.preload = "auto";
    a.addEventListener("canplaythrough", () => (this.hasFile = true), { once: true });
    a.addEventListener("error", () => (this.hasFile = false), { once: true });
    a.load();
    this.audio = a;
    // 일부 브라우저는 목소리 목록을 늦게 불러온다
    if (typeof speechSynthesis !== "undefined") speechSynthesis.getVoices();
  }

  play() {
    this.stop();
    if (this.hasFile && this.audio) {
      this.audio.currentTime = 0;
      this.audio.play().catch(() => this.speak());
      return;
    }
    this.speak();
  }

  stop() {
    clearTimeout(this.timer);
    this.audio?.pause();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }

  private speak() {
    if (typeof speechSynthesis === "undefined") return;
    const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith("ja"));
    const say = (text: string, rate: number) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ja-JP";
      if (voice) u.voice = voice;
      u.rate = rate;
      u.pitch = 0.8;
      speechSynthesis.speak(u);
    };
    say("領域展開", 0.85);
    this.timer = setTimeout(() => say("無量空処", 0.75), VOID_CUES.ttsSecondLine * 1000);
  }
}
