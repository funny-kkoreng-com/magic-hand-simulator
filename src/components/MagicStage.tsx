"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HandLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";
import { MagicEngine, type HandState } from "@/lib/magicEngine";
import { analyzeHand, type FingerState, type HandAnalysis } from "@/lib/gestures";
import { SPELL_MAP, type SpellId } from "@/lib/spells";
import {
  ULTIMATE_MAP,
  UltimateController,
  sealIcon,
  type SeenHand,
  type UltimateId,
  type UltimateView,
} from "@/lib/ultimates";
import { composePhoto, drawComposite, fileStamp, outputSize, pickRecordingType, type CompositeOptions } from "@/lib/photo";
import GestureGuide from "./GestureGuide";

// shine-my-bald와 같은 손 인식 설정
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

type Status = "idle" | "loading" | "running" | "error";

/** 손별 손동작 안정화 상태 (깜빡임 방지) */
interface Tracked {
  candidate: SpellId | null;
  since: number;
  confirmed: SpellId | null;
  lastSpellAt: number;
  hand: HandState | null;
  points: { x: number; y: number }[];
  analysis: HandAnalysis | null;
  lastSeen: number;
}

const CONFIRM_MS = 180;
const RELEASE_MS = 250;
const BANNER_REPEAT_MS = 3000;
const MAX_REC_SECONDS = 30;
const FINGER_LABEL: Record<FingerState, string> = { out: "폄", folded: "접힘", unsure: "?" };
const PALM_IDX = [0, 5, 9, 13, 17];

const IDLE_VIEW: UltimateView = { phase: "idle", id: null, sealsDone: 0, progress: 0, cooldownLeft: 0 };

// MediaPipe wasm은 "INFO: Created TensorFlow Lite XNNPACK delegate..." 같은 안내 로그를
// console.error로 찍어서 Next.js 개발 오버레이에 에러로 뜬다. 이 INFO 로그만 걸러낸다.
let mediapipeLogFilterInstalled = false;
function silenceMediapipeInfoLogs() {
  if (mediapipeLogFilterInstalled) return;
  mediapipeLogFilterInstalled = true;
  const original = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("INFO: ")) return;
    original(...args);
  };
}

async function loadLandmarker(): Promise<HandLandmarker> {
  silenceMediapipeInfoLogs();
  const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const create = (delegate: "GPU" | "CPU") =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.4,
      minHandPresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    });
  try {
    return await create("GPU");
  } catch (e) {
    console.warn("GPU 손 인식 실패, CPU로 재시도", e);
    return await create("CPU");
  }
}

export default function MagicStage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shakeRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const darkRef = useRef<HTMLDivElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const showDotsRef = useRef(true);
  const showDebugRef = useRef(false);
  const autoShotRef = useRef(true);
  const captureRef = useRef(false);
  const countingRef = useRef(false);
  const photoOpenRef = useRef(false);
  const recCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [activeIds, setActiveIds] = useState<SpellId[]>([]);
  const [banner, setBanner] = useState<{ id: SpellId; key: number } | null>(null);
  const [ultBanner, setUltBanner] = useState<{ id: UltimateId; key: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; color: string; key: number } | null>(null);
  const [ultView, setUltView] = useState<UltimateView>(IDLE_VIEW);
  const [showDots, setShowDots] = useState(true);
  const [showDebug, setShowDebug] = useState(false);
  const [autoShot, setAutoShot] = useState(true);
  const [photo, setPhoto] = useState<{ url: string; name: string; kind: "image" | "video" } | null>(null);
  const [recSeconds, setRecSeconds] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    showDotsRef.current = showDots;
    showDebugRef.current = showDebug;
    autoShotRef.current = autoShot;
  }, [showDots, showDebug, autoShot]);

  useEffect(() => {
    photoOpenRef.current = photo !== null;
  }, [photo]);

  // 배너/안내 문구는 애니메이션이 끝나면 화면에서 제거
  useEffect(() => {
    if (!banner) return;
    const id = setTimeout(() => setBanner(null), 900);
    return () => clearTimeout(id);
  }, [banner]);
  useEffect(() => {
    if (!ultBanner) return;
    const id = setTimeout(() => setUltBanner(null), 1600);
    return () => clearTimeout(id);
  }, [ultBanner]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1000);
    return () => clearTimeout(id);
  }, [toast]);

  const runLoop = useCallback(() => {
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const engine = new MagicEngine();
    const ult = new UltimateController();
    const tracked = new Map<string, Tracked>();
    let lastVideoTime = -1;
    let lastFrame = performance.now();
    let activeKey = "";
    const lastBannerAt = new Map<SpellId, number>();
    let viewKey = "";
    let autoCaptureAt = 0;

    const frame = () => {
      rafRef.current = requestAnimationFrame(frame);
      const now = performance.now();
      const dt = Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;

      // 캔버스를 화면 크기에 맞춤
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      // 비디오 정규화 좌표 → 화면 좌표 (object-cover 크롭 + 좌우 반전 반영)
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 480;
      const scale = Math.max(cw / vw, ch / vh);
      const ox = (cw - vw * scale) / 2;
      const oy = (ch - vh * scale) / 2;
      const toScreen = (p: NormalizedLandmark) => ({
        x: (1 - p.x) * vw * scale + ox,
        y: p.y * vh * scale + oy,
        // 깊이 (작을수록 카메라에 가까움). x와 같은 px 단위로 맞춤
        z: p.z * vw * scale,
      });

      const landmarker = landmarkerRef.current;
      if (landmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const result = landmarker.detectForVideo(video, now);
        const usedKeys = new Set<string>();

        result.landmarks.forEach((lms, i) => {
          let key = result.handedness[i]?.[0]?.categoryName ?? `hand${i}`;
          if (usedKeys.has(key)) key = `${key}${i}`;
          usedKeys.add(key);

          const pts = lms.map(toScreen);
          const palm = {
            x: PALM_IDX.reduce((s, j) => s + pts[j].x, 0) / PALM_IDX.length,
            y: PALM_IDX.reduce((s, j) => s + pts[j].y, 0) / PALM_IDX.length,
          };
          const size = Math.hypot(pts[9].x - pts[0].x, pts[9].y - pts[0].y) || 50;
          const raw: HandState = { wrist: pts[0], palm, indexTip: pts[8], middleTip: pts[12], thumbTip: pts[4], size };

          const t = tracked.get(key) ?? {
            candidate: null,
            since: now,
            confirmed: null,
            lastSpellAt: 0,
            hand: null,
            points: pts,
            analysis: null,
            lastSeen: now,
          };
          // 위치 스무딩
          const prev = t.hand;
          const lerp = (a: number, b: number) => a + (b - a) * 0.6;
          const lerpV = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: lerp(a.x, b.x), y: lerp(a.y, b.y) });
          t.hand = prev
            ? {
                wrist: lerpV(prev.wrist, raw.wrist),
                palm: lerpV(prev.palm, raw.palm),
                indexTip: lerpV(prev.indexTip, raw.indexTip),
                middleTip: lerpV(prev.middleTip, raw.middleTip),
                thumbTip: lerpV(prev.thumbTip, raw.thumbTip),
                size: lerp(prev.size, raw.size),
              }
            : raw;
          t.points = pts;
          t.lastSeen = now;

          t.analysis = analyzeHand(pts);
          const g = t.analysis.gesture;
          if (g !== t.candidate) {
            t.candidate = g;
            t.since = now;
          }
          if (g) t.lastSpellAt = now;
          if (g && g !== t.confirmed && now - t.since >= CONFIRM_MS) {
            t.confirmed = g;
            if ((ult.phase === "idle" || ult.phase === "cooldown") && now - (lastBannerAt.get(g) ?? -Infinity) > BANNER_REPEAT_MS) {
              lastBannerAt.set(g, now);
              setBanner({ id: g, key: now });
            }
          } else if (!g && t.confirmed && now - t.lastSpellAt >= RELEASE_MS) {
            t.confirmed = null;
          }
          tracked.set(key, t);
        });
      }

      // 화면에서 사라진 손 정리
      for (const [key, t] of tracked) {
        if (now - t.lastSeen > 400) tracked.delete(key);
      }
      const visible = [...tracked.entries()].filter(([, t]) => t.hand && now - t.lastSeen <= 150);

      // 궁극기 (두 손)
      const seen: SeenHand[] = visible.map(([, t]) => ({ gesture: t.confirmed, hand: t.hand! }));
      for (const ev of ult.update(now, dt, seen)) {
        if (ev.type === "seal") {
          engine.flash = Math.max(engine.flash, 0.15);
          engine.flashColor = ULTIMATE_MAP[ult.ult!.id].color;
        } else if (ev.type === "fail") {
          setToast({ text: "💨 결인 실패...", color: "#ff8080", key: now });
        } else if (ev.type === "ready") {
          setToast({ text: "결인 완료! 마지막 자세를 유지하세요", color: ULTIMATE_MAP[ult.ult!.id].color, key: now });
        } else if (ev.type === "release") {
          setUltBanner({ id: ev.id, key: now });
          engine.flash = 1;
          engine.flashColor = ULTIMATE_MAP[ev.id].color;
          engine.shake = 1;
          // 궁극기가 제일 화려한 순간 자동 촬영
          if (autoShotRef.current && !photoOpenRef.current && !recCanvasRef.current) autoCaptureAt = now + 500;
        }
      }

      const ultActive = ult.phase === "charging" || ult.phase === "pushing" || ult.phase === "release";
      const ultStage = ult.phase === "release" ? "release" : "charge";
      const ultT = (now - ult.phaseStart) / 1000;
      const ultP = ult.phase === "charging" ? ult.charge : 1;

      // 일반 마법 (궁극기 발동 중에는 쉼)
      const active: SpellId[] = [];
      if (ult.phase !== "release") {
        for (const [key, t] of visible) {
          if (!t.confirmed) continue;
          active.push(t.confirmed);
          engine.drawAura(ctx, t.confirmed, t.hand!, SPELL_MAP[t.confirmed].color);
          engine.cast(t.confirmed, t.hand!, dt, key);
        }
      }
      if (ultActive && ult.ult) {
        engine.ultimate(ult.ult.id, ultStage, ult.center, ult.size, ultP, ultT, dt, cw, ch);
      }
      engine.update(dt);
      engine.draw(ctx);
      if (ultActive && ult.ult) {
        engine.drawUltimate(ctx, ult.ult.id, ultStage, ult.center, ult.size, ultP, ultT);
      }

      const dark = ult.phase === "release" ? 0.55 : ult.phase === "charging" ? ult.charge * 0.4 : ult.phase === "pushing" ? 0.4 : 0;

      // 사진 / 영상 (손 점·판정 글씨를 그리기 전의 이펙트만 담는다)
      const wantPhoto = captureRef.current || (autoCaptureAt && now >= autoCaptureAt);
      const recCanvas = recCanvasRef.current;
      if (wantPhoto || recCanvas) {
        const ultLabel = ult.phase === "release" && ult.ult ? ult.ult : null;
        const composite: CompositeOptions = {
          video,
          effects: canvas,
          darkness: dark,
          label: ultLabel
            ? `${ultLabel.icon} ${ultLabel.name}`
            : active.length
              ? [...new Set(active)].map((id) => `${SPELL_MAP[id].icon} ${SPELL_MAP[id].spellName}`).join("   ")
              : null,
          labelColor: ultLabel ? ultLabel.color : active.length ? SPELL_MAP[active[0]].color : "#fff",
        };
        if (recCanvas) drawComposite(recCanvas, composite);
        if (wantPhoto) {
          captureRef.current = false;
          autoCaptureAt = 0;
          composePhoto(composite)
            .then((blob) => {
              if (!blob) return;
              const url = URL.createObjectURL(blob);
              setPhoto((prev) => {
                if (prev) URL.revokeObjectURL(prev.url);
                return { url, name: `magic-hand-${fileStamp()}.png`, kind: "image" };
              });
            })
            .catch((e) => console.error("사진 촬영 실패", e));
          engine.flash = 0.9;
          engine.flashColor = "#ffffff";
        }
      }

      // 손 점 (shine-my-bald와 같은 스타일)
      if (showDotsRef.current) {
        ctx.save();
        for (const [, t] of visible) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
          for (const p of t.points) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.beginPath();
          ctx.arc(t.hand!.palm.x, t.hand!.palm.y, 12, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        ctx.restore();
      }

      // 판정 보기: 손가락별 판정 결과를 손 위에 표시 (인식이 안 될 때 원인 확인용)
      if (showDebugRef.current) {
        ctx.save();
        ctx.font = "bold 13px ui-monospace, monospace";
        ctx.textAlign = "center";
        for (const [, t] of visible) {
          const a = t.analysis;
          if (!a) continue;
          const lines = [
            `→ ${a.gesture ? SPELL_MAP[a.gesture].gestureName : "인식 안 됨"}`,
            ["검지", "중지", "약지", "새끼"].map((n, i) => `${n}:${FINGER_LABEL[a.fingers[i]]}`).join(" "),
            `엄지:${a.thumbOut ? "폄" : "접음"}  말림:${a.curl.toFixed(2)}  손끝 앞쪽:${a.tipsCloser.toFixed(2)}`,
          ];
          const x = t.hand!.palm.x;
          let y = t.hand!.palm.y - t.hand!.size * 1.9;
          for (const line of lines) {
            const w = ctx.measureText(line).width + 12;
            ctx.fillStyle = "rgba(0,0,0,0.7)";
            ctx.fillRect(x - w / 2, y - 14, w, 19);
            ctx.fillStyle = "#fff";
            ctx.fillText(line, x, y);
            y += 20;
          }
        }
        ctx.restore();
      }

      // 화면 흔들림 / 섬광 / 어둡게
      const sh = engine.shake * 14;
      shakeRef.current!.style.transform = sh > 0.3 ? `translate(${(Math.random() - 0.5) * sh}px, ${(Math.random() - 0.5) * sh}px)` : "";
      flashRef.current!.style.opacity = String(engine.flash * 0.8);
      flashRef.current!.style.background = engine.flashColor;
      darkRef.current!.style.opacity = String(dark);

      const nextKey = [...new Set(active)].sort().join(",");
      if (nextKey !== activeKey) {
        activeKey = nextKey;
        setActiveIds(nextKey ? (nextKey.split(",") as SpellId[]) : []);
      }
      const v = ult.view(now);
      const vk = `${v.phase}|${v.id}|${v.sealsDone}|${Math.round(v.progress * 40)}|${Math.ceil(v.cooldownLeft / 1000)}`;
      if (vk !== viewKey) {
        viewKey = vk;
        setUltView(v);
      }
    };
    frame();
  }, []);

  const start = useCallback(async () => {
    setError("");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setError(
        `카메라는 https 또는 localhost 주소에서만 켤 수 있어요. http://localhost:${window.location.port || 80} 으로 열어 주세요.`,
      );
      return;
    }
    setStatus("loading");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      console.error(e);
      const name = e instanceof DOMException ? e.name : "";
      setStatus("error");
      setError(
        name === "NotAllowedError"
          ? "카메라 권한이 거부됐어요. 주소창 왼쪽 아이콘에서 카메라를 허용해 주세요. (macOS라면 시스템 설정 › 개인정보 보호 › 카메라에서 브라우저도 허용)"
          : name === "NotFoundError"
            ? "연결된 카메라를 찾지 못했어요."
            : name === "NotReadableError"
              ? "다른 앱(Zoom, FaceTime 등)이 카메라를 쓰고 있어요."
              : `카메라를 켜지 못했어요. (${name || String(e)})`,
      );
      return;
    }
    try {
      landmarkerRef.current ??= await loadLandmarker();
    } catch (e) {
      console.error(e);
      setStatus("error");
      setError("손 인식 모델을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.");
      return;
    }
    setStatus("running");
    runLoop();
  }, [runLoop]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      clearInterval(recTimerRef.current);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      landmarkerRef.current?.close();
    };
  }, []);

  const closeGuide = useCallback(() => setGuideOpen(false), []);

  // 3, 2, 1 카운트다운 후 촬영
  const takePhoto = useCallback(() => {
    if (countingRef.current) return;
    countingRef.current = true;
    setCountdown(3);
    setTimeout(() => setCountdown(2), 1000);
    setTimeout(() => setCountdown(1), 2000);
    setTimeout(() => {
      setCountdown(null);
      captureRef.current = true;
      countingRef.current = false;
    }, 3000);
  }, []);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  // 녹화: 화면과 같은 합성 영상을 별도 캔버스에 매 프레임 그리고, 그 캔버스를 녹화한다
  const startRecording = useCallback(() => {
    if (recorderRef.current) return;
    const type = pickRecordingType();
    const video = videoRef.current;
    if (!type || !video) {
      setToast({ text: "이 브라우저는 영상 녹화를 지원하지 않아요", color: "#ff8080", key: performance.now() });
      return;
    }
    const rc = document.createElement("canvas");
    Object.assign(rc, outputSize(video));
    const recorder = new MediaRecorder(rc.captureStream(30), { mimeType: type.mimeType, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    recorder.onstop = () => {
      clearInterval(recTimerRef.current);
      recCanvasRef.current = null;
      recorderRef.current = null;
      setRecSeconds(null);
      const blob = new Blob(chunks, { type: type.mimeType.split(";")[0] });
      if (blob.size === 0) return;
      const url = URL.createObjectURL(blob);
      setPhoto((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { url, name: `magic-hand-${fileStamp()}.${type.ext}`, kind: "video" };
      });
    };
    recCanvasRef.current = rc;
    recorderRef.current = recorder;
    recorder.start(250);
    const startedAt = performance.now();
    setRecSeconds(0);
    recTimerRef.current = setInterval(() => {
      const sec = Math.floor((performance.now() - startedAt) / 1000);
      setRecSeconds(sec);
      if (sec >= MAX_REC_SECONDS) recorder.stop();
    }, 250);
  }, []);

  const closePhoto = useCallback(() => {
    setPhoto((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);
  const bannerSpell = banner ? SPELL_MAP[banner.id] : null;
  const bannerUlt = ultBanner ? ULTIMATE_MAP[ultBanner.id] : null;
  const hudUlt = ultView.id ? ULTIMATE_MAP[ultView.id] : null;
  const showHud = hudUlt && (ultView.phase === "sealing" || ultView.phase === "charging" || ultView.phase === "pushing");

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#06040f] text-white">
      <div ref={shakeRef} className="absolute -inset-4">
        <div className="absolute inset-4">
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 h-full w-full -scale-x-100 object-cover brightness-[0.65] saturate-[0.8]"
          />
          <div ref={darkRef} className="pointer-events-none absolute inset-0 bg-black opacity-0" />
          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        </div>
      </div>
      <div ref={flashRef} className="pointer-events-none absolute inset-0 z-[5] opacity-0 mix-blend-screen" />

      {/* 상단 바 */}
      <div className="absolute left-4 top-4 z-20 flex items-center gap-2">
        <button
          onClick={() => setGuideOpen(true)}
          aria-label="손동작 가이드 열기"
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-black/40 backdrop-blur-md transition hover:bg-white/15"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="rounded-xl bg-black/30 px-3 py-2 text-sm font-semibold backdrop-blur-md">🪄 Magic Hand</span>
      </div>

      {status === "running" && (
        <div className="absolute right-4 top-4 z-20 flex flex-col items-end gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-black/40 px-3 py-2 text-xs backdrop-blur-md">
            <input type="checkbox" checked={showDots} onChange={(e) => setShowDots(e.target.checked)} />
            손 점 보기
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-black/40 px-3 py-2 text-xs backdrop-blur-md">
            <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} />
            판정 보기
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-black/40 px-3 py-2 text-xs backdrop-blur-md">
            <input type="checkbox" checked={autoShot} onChange={(e) => setAutoShot(e.target.checked)} />
            궁극기 자동 촬영
          </label>
          {ultView.phase === "cooldown" && (
            <span className="rounded-xl bg-black/40 px-3 py-2 text-xs text-white/70 backdrop-blur-md">
              궁극기 재충전 {Math.ceil(ultView.cooldownLeft / 1000)}초
            </span>
          )}
        </div>
      )}

      {/* 궁극기 결인 / 차징 HUD */}
      {showHud && (
        <div
          className="absolute bottom-20 left-1/2 z-20 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl border bg-black/55 px-4 py-3 backdrop-blur-md"
          style={{ borderColor: hudUlt.color, boxShadow: `0 0 30px ${hudUlt.color}55` }}
        >
          <div className="flex items-center justify-between text-sm font-bold" style={{ color: hudUlt.color }}>
            <span>
              {hudUlt.icon} {hudUlt.name}
            </span>
            <span className="text-xs font-normal text-white/60">
              {ultView.phase === "sealing" ? "결인 중" : ultView.phase === "charging" ? "차징 중" : "지금!"}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-center gap-2">
            {hudUlt.seals.map((seal, i) => (
              <span
                key={i}
                className="rounded-lg px-2 py-1 text-xl transition"
                style={{
                  background: i < ultView.sealsDone ? `${hudUlt.color}55` : "rgba(255,255,255,0.06)",
                  opacity: i < ultView.sealsDone ? 1 : 0.45,
                  outline: i === ultView.sealsDone && ultView.phase === "sealing" ? `2px solid ${hudUlt.color}` : undefined,
                }}
              >
                {sealIcon(seal)}
              </span>
            ))}
          </div>
          <p className="mt-2 text-center text-xs text-white/80">
            {ultView.phase === "sealing"
              ? "다음 인을 맺으세요!"
              : ultView.phase === "charging"
                ? hudUlt.finalStep
                : "👐 두 손을 카메라 쪽으로 쭉 밀어요!"}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full"
              style={{ width: `${ultView.progress * 100}%`, background: hudUlt.color, transition: "width 80ms linear" }}
            />
          </div>
        </div>
      )}

      {/* 현재 시전 중인 마법 */}
      {status === "running" && (
        <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 flex-wrap justify-center gap-2">
          {activeIds.length === 0 ? (
            <span className="whitespace-nowrap rounded-full bg-black/40 px-4 py-2 text-sm text-white/70 backdrop-blur-md">
              손을 카메라에 보여주세요 · 왼쪽 위 ☰ 에서 손동작 확인
            </span>
          ) : (
            activeIds.map((id) => (
              <span
                key={id}
                className="rounded-full px-4 py-2 text-sm font-bold backdrop-blur-md"
                style={{ background: `${SPELL_MAP[id].color}33`, border: `1px solid ${SPELL_MAP[id].color}` }}
              >
                {SPELL_MAP[id].hand} {SPELL_MAP[id].icon} {SPELL_MAP[id].spellName}
              </span>
            ))
          )}
        </div>
      )}

      {/* 마법 이름 배너 */}
      {bannerSpell && !showHud && ultView.phase !== "release" && (
        <div
          key={banner!.key}
          className="spell-banner pointer-events-none absolute left-1/2 top-[18%] z-10 text-center"
          style={{ color: bannerSpell.color, textShadow: `0 0 24px ${bannerSpell.color}, 0 0 4px #000` }}
        >
          <div className="text-5xl">{bannerSpell.icon}</div>
          <div className="mt-1 text-3xl font-black tracking-wider sm:text-4xl">{bannerSpell.spellName}!</div>
        </div>
      )}

      {/* 궁극기 컷인 */}
      {bannerUlt && (
        <div
          key={ultBanner!.key}
          className="ult-banner pointer-events-none absolute inset-x-0 top-1/2 z-10 py-6 text-center"
          style={{
            color: "#fff",
            background: `linear-gradient(90deg, transparent, ${bannerUlt.color}aa, transparent)`,
            textShadow: `0 0 30px ${bannerUlt.color}, 0 0 6px #000`,
          }}
        >
          <div className="text-xs font-bold tracking-[0.4em] text-white/80">ULTIMATE</div>
          <div className="text-5xl font-black tracking-widest sm:text-7xl">
            {bannerUlt.icon} {bannerUlt.name}
          </div>
        </div>
      )}

      {toast && (
        <div
          key={toast.key}
          className="toast pointer-events-none absolute left-1/2 top-[30%] z-10 whitespace-nowrap rounded-full bg-black/60 px-5 py-2 text-base font-bold backdrop-blur-md"
          style={{ color: toast.color }}
        >
          {toast.text}
        </div>
      )}

      {/* 시작 / 로딩 / 에러 화면 */}
      {status !== "running" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 bg-[radial-gradient(ellipse_at_center,#2a1660_0%,#06040f_70%)] px-6 text-center">
          <div className="text-6xl">🪄✨</div>
          <h1 className="text-3xl font-black sm:text-4xl">매직 핸드 시뮬레이터</h1>
          <p className="max-w-md text-white/70">
            웹캠 앞에서 손동작을 하면 마법이 펼쳐져요.
            <br />
            두 손으로 인을 맺으면 궁극기도! 왼쪽 위 ☰ 버튼에서 주문서를 확인하세요.
          </p>
          {status === "error" && <p className="max-w-md rounded-xl bg-red-500/20 px-4 py-3 text-sm text-red-200">{error}</p>}
          <button
            onClick={start}
            disabled={status === "loading"}
            className="rounded-2xl bg-gradient-to-r from-fuchsia-500 to-indigo-500 px-8 py-4 text-lg font-bold shadow-[0_0_40px_rgba(180,90,255,0.5)] transition hover:scale-105 disabled:cursor-wait disabled:opacity-60 disabled:hover:scale-100"
          >
            {status === "loading" ? "마법 준비 중..." : status === "error" ? "다시 시도" : "📷 카메라 켜고 시작"}
          </button>
          <p className="text-xs text-white/40">영상은 기기 안에서만 처리되고 어디에도 전송되지 않아요.</p>
        </div>
      )}

      {status === "running" && (
        <div className="absolute bottom-5 right-4 z-20 flex flex-col items-end gap-2">
          <button
            onClick={takePhoto}
            disabled={countdown !== null || recSeconds !== null}
            className="rounded-full border border-white/40 bg-black/50 px-4 py-2.5 text-sm font-bold backdrop-blur-md transition hover:bg-white/15 disabled:opacity-40"
          >
            📸 사진
          </button>
          <button
            onClick={recSeconds === null ? startRecording : stopRecording}
            className={`flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-bold backdrop-blur-md transition ${
              recSeconds === null ? "border-white/40 bg-black/50 hover:bg-white/15" : "border-red-400 bg-red-500/40 hover:bg-red-500/60"
            }`}
          >
            {recSeconds === null ? (
              <>
                <span className="h-3 w-3 rounded-full bg-red-500" /> 영상 녹화
              </>
            ) : (
              <>
                <span className="h-3 w-3 rounded-sm bg-white" /> 녹화 중지 {Math.floor(recSeconds / 60)}:
                {String(recSeconds % 60).padStart(2, "0")}
              </>
            )}
          </button>
        </div>
      )}

      {recSeconds !== null && (
        <div className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm font-bold backdrop-blur-md">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          REC {Math.floor(recSeconds / 60)}:{String(recSeconds % 60).padStart(2, "0")} / 0:{MAX_REC_SECONDS}
        </div>
      )}

      {countdown !== null && (
        <div
          key={countdown}
          className="toast pointer-events-none absolute left-1/2 top-1/2 z-30 -mt-16 text-9xl font-black text-white"
          style={{ textShadow: "0 0 30px rgba(255,255,255,0.8), 0 0 6px #000" }}
        >
          {countdown}
        </div>
      )}

      {photo && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/75 p-4 backdrop-blur-sm" onClick={closePhoto}>
          {photo.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob URL 미리보기
            <img
              src={photo.url}
              alt="마법 사진"
              onClick={(e) => e.stopPropagation()}
              className="max-h-[60vh] w-auto max-w-[min(90vw,720px)] rounded-2xl border border-white/20 shadow-2xl"
            />
          ) : (
            <video
              src={photo.url}
              controls
              autoPlay
              loop
              playsInline
              onClick={(e) => e.stopPropagation()}
              className="max-h-[60vh] w-auto max-w-[min(90vw,720px)] rounded-2xl border border-white/20 shadow-2xl"
            />
          )}
          <div className="flex gap-3" onClick={(e) => e.stopPropagation()}>
            <a
              href={photo.url}
              download={photo.name}
              className="rounded-xl bg-gradient-to-r from-fuchsia-500 to-indigo-500 px-6 py-3 font-bold shadow-[0_0_30px_rgba(180,90,255,0.5)] transition hover:scale-105"
            >
              💾 저장
            </a>
            <button onClick={closePhoto} className="rounded-xl border border-white/20 bg-white/10 px-6 py-3 font-bold transition hover:bg-white/20">
              닫기
            </button>
          </div>
        </div>
      )}

      <GestureGuide open={guideOpen} onClose={closeGuide} activeIds={activeIds} ultView={ultView} />
    </main>
  );
}
