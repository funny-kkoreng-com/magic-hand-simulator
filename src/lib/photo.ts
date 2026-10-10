export interface CompositeOptions {
  video: HTMLVideoElement;
  /** 마법 이펙트만 그려진 캔버스 (손 점·판정 글씨를 그리기 전 상태) */
  effects: HTMLCanvasElement;
  /** 궁극기 중 화면을 어둡게 한 정도 (0~1) */
  darkness: number;
  label: string | null;
  labelColor: string;
}

/** 출력 크기: 카메라 원래 비율 그대로, 가로 1280px (영상 인코더를 위해 짝수) */
export function outputSize(video: HTMLVideoElement) {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const w = 1280;
  return { width: w, height: Math.round((w * vh) / vw / 2) * 2 };
}

/**
 * 카메라 화면 전체(좌우 반전)를 out 캔버스에 그리고, 그 위에 마법 이펙트를 같은 위치에 맞춰 합성.
 * 화면은 카메라 영상을 object-cover로 잘라 보여주므로, 이펙트 캔버스를 카메라 좌표로 되돌려 얹는다.
 */
export function drawComposite(out: HTMLCanvasElement, { video, effects, darkness, label, labelColor }: CompositeOptions) {
  const w = out.width;
  const h = out.height;
  const ctx = out.getContext("2d")!;

  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.filter = "brightness(0.65) saturate(0.8)";
  ctx.drawImage(video, 0, 0, w, h);
  ctx.restore();

  if (darkness > 0) {
    ctx.fillStyle = `rgba(0,0,0,${darkness})`;
    ctx.fillRect(0, 0, w, h);
  }

  // 화면(px) → 출력(px) 변환
  const cw = effects.clientWidth || w;
  const ch = effects.clientHeight || h;
  const screenScale = Math.max(cw / vw, ch / vh);
  const ox = (cw - vw * screenScale) / 2;
  const oy = (ch - vh * screenScale) / 2;
  const k = w / vw / screenScale;
  ctx.drawImage(effects, -ox * k, -oy * k, cw * k, ch * k);

  const u = Math.min(w, h) / 100;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  if (label) {
    ctx.font = `900 ${u * 7}px system-ui, "Apple SD Gothic Neo", sans-serif`;
    ctx.textAlign = "center";
    ctx.shadowColor = labelColor;
    ctx.shadowBlur = u * 4;
    ctx.fillStyle = "#fff";
    ctx.fillText(label, w / 2, h - u * 6);
    ctx.shadowBlur = 0;
  }
  ctx.font = `700 ${u * 3}px system-ui, "Apple SD Gothic Neo", sans-serif`;
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText("🪄 Magic Hand", w - u * 3, u * 5);
  ctx.restore();
}

/** 사진 한 장 (PNG) */
export function composePhoto(opts: CompositeOptions): Promise<Blob | null> {
  const out = document.createElement("canvas");
  Object.assign(out, outputSize(opts.video));
  drawComposite(out, opts);
  return new Promise((res) => out.toBlob(res, "image/png"));
}

/** 이 브라우저에서 녹화 가능한 형식 (Safari는 mp4, Chrome은 webm/mp4) */
export function pickRecordingType(): { mimeType: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    { mimeType: "video/mp4;codecs=avc1", ext: "mp4" },
    { mimeType: "video/mp4", ext: "mp4" },
    { mimeType: "video/webm;codecs=vp9", ext: "webm" },
    { mimeType: "video/webm", ext: "webm" },
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c.mimeType)) ?? null;
}

export function fileStamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
