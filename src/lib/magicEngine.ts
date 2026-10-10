import type { SpellId } from "./spells";
import type { UltimateId } from "./ultimates";
import { VOID_CUES } from "./voidVoice";

export interface Vec {
  x: number;
  y: number;
}

/** 화면 좌표(px)로 변환된 한 손의 정보 */
export interface HandState {
  wrist: Vec;
  palm: Vec;
  indexTip: Vec;
  middleTip: Vec;
  thumbTip: Vec;
  /** 손 크기(px) — 손목~중지 뿌리 거리 */
  size: number;
}

type Shape = "glow" | "star" | "heart" | "flake" | "plus" | "emoji" | "streak" | "glyph";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ay: number;
  drag: number;
  life: number;
  max: number;
  size: number;
  color: string;
  shape: Shape;
  rot: number;
  vr: number;
  wobble: number;
  emoji?: string;
  orbit?: { cx: number; cy: number; angle: number; radius: number; speed: number };
}

interface Bolt {
  points: Vec[];
  life: number;
  max: number;
  scale: number;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  groundY: number;
}

export type UltStage = "charge" | "release";

interface Ring {
  x: number;
  y: number;
  r: number;
  vr: number;
  life: number;
  max: number;
  color: string;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]) => arr[(Math.random() * arr.length) | 0];

const MAX_PARTICLES = 1800;

const spriteCache = new Map<string, HTMLCanvasElement>();
function glowSprite(color: string) {
  let c = spriteCache.get(color);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.2, color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  spriteCache.set(color, c);
  return c;
}

const glyphCache = new Map<string, HTMLCanvasElement>();
/** 빛나는 글자 (무량공처의 무한한 정보) */
function glyphSprite(ch: string, color: string) {
  const key = ch + color;
  let c = glyphCache.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.font = 'bold 40px "Hiragino Mincho ProN", "Noto Serif CJK JP", "Apple SD Gothic Neo", serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = color;
  g.shadowBlur = 12;
  g.fillStyle = "#ffffff";
  g.fillText(ch, 32, 34);
  g.fillText(ch, 32, 34);
  glyphCache.set(key, c);
  return c;
}

const VOID_GLYPHS = ["無", "量", "空", "処", "∞", "π", "∑", "∂", "λ", "0", "1", "Ω", "∫"];

const emojiCache = new Map<string, HTMLCanvasElement>();
function emojiSprite(emoji: string) {
  let c = emojiCache.get(emoji);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 96;
  const g = c.getContext("2d")!;
  g.font = '76px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(emoji, 48, 54);
  emojiCache.set(emoji, c);
  return c;
}

function makeBolt(from: Vec, to: Vec, roughness: number): Vec[] {
  let pts: Vec[] = [from, to];
  let offset = roughness;
  for (let i = 0; i < 5; i++) {
    const next: Vec[] = [pts[0]];
    for (let j = 0; j < pts.length - 1; j++) {
      const a = pts[j];
      const b = pts[j + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const n = rand(-offset, offset);
      next.push({ x: (a.x + b.x) / 2 + (-dy / len) * n, y: (a.y + b.y) / 2 + (dx / len) * n }, b);
    }
    pts = next;
    offset /= 2;
  }
  return pts;
}

export class MagicEngine {
  private particles: Particle[] = [];
  private bolts: Bolt[] = [];
  private rings: Ring[] = [];
  private meteors: Meteor[] = [];
  private ringTimers = new Map<string, number>();
  private time = 0;
  private strikeTimer = 0;
  private meteorTimer = 0;
  private voidStars: { a: number; r: number; size: number; tw: number }[] = [];
  private voidOrigin: Vec | null = null;
  private voidRingTimer = 0;
  private voidFlashed = false;
  private voidPrevT = -1;
  /** 화면 흔들림 / 섬광 세기 (0~1). 컴포넌트가 읽어서 화면에 반영 */
  shake = 0;
  flash = 0;
  flashColor = "#ffffff";

  private emit(p: Partial<Particle> & { x: number; y: number }) {
    if (this.particles.length >= MAX_PARTICLES) return;
    const max = p.max ?? 1;
    this.particles.push({
      vx: 0,
      vy: 0,
      ay: 0,
      drag: 0.98,
      size: 10,
      color: "#fff",
      shape: "glow",
      rot: Math.random() * Math.PI * 2,
      vr: 0,
      wobble: 0,
      ...p,
      life: max,
      max,
    });
  }

  /** 매 프레임 손 하나에 대해 해당 마법을 시전한다. key는 손 구분용 */
  cast(spell: SpellId, hand: HandState, dt: number, key: string) {
    const s = hand.size;
    const { palm } = hand;
    // 프레임 레이트와 무관하게 비슷한 양이 나오도록
    const k = Math.min(dt * 60, 3);
    const count = (n: number) => Math.round(n * k * rand(0.6, 1.4));

    switch (spell) {
      case "Open_Palm": {
        const colors = ["#fff3a0", "#ffc04a", "#ff7a1a", "#ff3d00"];
        for (let i = 0; i < count(7); i++) {
          const a = rand(0, Math.PI * 2);
          const r = rand(0, s * 0.35);
          this.emit({
            x: palm.x + Math.cos(a) * r,
            y: palm.y + Math.sin(a) * r * 0.6,
            vx: rand(-40, 40),
            vy: rand(-260, -120),
            drag: 0.97,
            size: rand(s * 0.25, s * 0.55),
            color: pick(colors),
            max: rand(0.45, 0.9),
          });
        }
        if (Math.random() < 0.4 * k) {
          this.emit({
            x: palm.x + rand(-s * 0.3, s * 0.3),
            y: palm.y,
            vx: rand(-80, 80),
            vy: rand(-380, -200),
            ay: 120,
            size: rand(3, 6),
            color: "#ffe08a",
            max: rand(0.8, 1.4),
          });
        }
        break;
      }
      case "Closed_Fist": {
        if (Math.random() < 0.35 * k) {
          const a = rand(0, Math.PI * 2);
          const len = rand(s * 1.8, s * 4);
          const to = { x: palm.x + Math.cos(a) * len, y: palm.y + Math.sin(a) * len };
          const points = makeBolt(palm, to, len * 0.25);
          this.bolts.push({ points, life: 0.16, max: 0.16, scale: 1 });
          for (let i = 0; i < 6; i++) {
            this.emit({
              x: to.x,
              y: to.y,
              vx: rand(-220, 220),
              vy: rand(-220, 220),
              drag: 0.9,
              size: rand(4, 10),
              color: "#7cc8ff",
              max: rand(0.2, 0.45),
            });
          }
        }
        for (let i = 0; i < count(2); i++) {
          const a = rand(0, Math.PI * 2);
          this.emit({
            x: palm.x + Math.cos(a) * s * 0.5,
            y: palm.y + Math.sin(a) * s * 0.5,
            vx: Math.cos(a) * 60,
            vy: Math.sin(a) * 60,
            size: rand(s * 0.15, s * 0.3),
            color: "#4aa8ff",
            max: rand(0.2, 0.4),
          });
        }
        break;
      }
      case "Pointing_Up": {
        const tip = hand.indexTip;
        for (let i = 0; i < count(3); i++) {
          this.emit({
            x: tip.x + rand(-4, 4),
            y: tip.y + rand(-4, 4),
            vx: rand(-30, 30),
            vy: rand(-30, 30),
            ay: 40,
            drag: 0.96,
            size: rand(5, 13),
            color: pick(["#ffd84a", "#fff6c2", "#ffb84a"]),
            shape: Math.random() < 0.6 ? "star" : "glow",
            vr: rand(-4, 4),
            max: rand(0.9, 1.6),
          });
        }
        break;
      }
      case "Victory": {
        const c = {
          x: (hand.indexTip.x + hand.middleTip.x) / 2,
          y: (hand.indexTip.y + hand.middleTip.y) / 2,
        };
        // 손바닥 → 손가락 끝 방향으로 흩뿌린다
        const base = Math.atan2(c.y - palm.y, c.x - palm.x);
        for (let i = 0; i < count(3); i++) {
          const a = base + rand(-0.7, 0.7);
          const sp = rand(120, 360);
          this.emit({
            x: c.x,
            y: c.y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            ay: 60,
            drag: 0.975,
            size: rand(6, 16),
            color: pick(["#8ff3ff", "#d8fbff", "#5fc8ff"]),
            shape: Math.random() < 0.65 ? "flake" : "glow",
            vr: rand(-3, 3),
            max: rand(0.9, 1.7),
          });
        }
        break;
      }
      case "Thumb_Up": {
        const last = this.ringTimers.get(key) ?? 0;
        if (this.time - last > 0.45) {
          this.ringTimers.set(key, this.time);
          this.rings.push({ x: palm.x, y: palm.y, r: s * 0.3, vr: s * 3.2, life: 0.9, max: 0.9, color: "#5dff9a" });
        }
        for (let i = 0; i < count(3); i++) {
          const a = rand(0, Math.PI * 2);
          const r = rand(s * 0.3, s * 1.4);
          this.emit({
            x: palm.x + Math.cos(a) * r,
            y: palm.y + Math.sin(a) * r,
            vy: rand(-140, -60),
            drag: 0.99,
            size: rand(5, 11),
            color: pick(["#5dff9a", "#b6ff7a", "#e6ffe9"]),
            shape: Math.random() < 0.5 ? "plus" : "glow",
            max: rand(0.8, 1.4),
          });
        }
        break;
      }
      case "Thumb_Down": {
        for (let i = 0; i < count(5); i++) {
          this.emit({
            x: palm.x,
            y: palm.y,
            size: rand(s * 0.08, s * 0.22),
            color: pick(["#b65cff", "#7a2cff", "#ff4ad8"]),
            max: rand(0.8, 1.3),
            orbit: {
              cx: palm.x,
              cy: palm.y,
              angle: rand(0, Math.PI * 2),
              radius: rand(s * 1.6, s * 2.8),
              speed: rand(3.5, 6),
            },
          });
        }
        break;
      }
      case "Middle_Finger": {
        // 손바닥 가운데에서 손끝 방향으로 연사
        const tip = hand.middleTip;
        const base = Math.atan2(tip.y - palm.y, tip.x - palm.x);
        for (let i = 0; i < count(0.9); i++) {
          const a = base + rand(-0.6, 0.6);
          const sp = rand(250, 520);
          this.emit({
            x: palm.x,
            y: palm.y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            ay: 250,
            drag: 0.985,
            size: rand(s * 0.25, s * 0.45),
            color: "#ff3b3b",
            shape: "emoji",
            emoji: "🖕",
            rot: rand(-0.4, 0.4),
            vr: rand(-3, 3),
            max: rand(1, 1.6),
          });
        }
        break;
      }
      case "Cat_Paw": {
        if (Math.random() < 0.12 * k) {
          const a = rand(-Math.PI * 0.85, -Math.PI * 0.15);
          const sp = rand(120, 260);
          this.emit({
            x: palm.x + rand(-s * 0.4, s * 0.4),
            y: palm.y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            ay: 200,
            drag: 0.99,
            size: rand(s * 0.18, s * 0.3),
            shape: "emoji",
            emoji: "🐾",
            rot: rand(-0.5, 0.5),
            vr: rand(-2, 2),
            max: rand(0.9, 1.4),
          });
        }
        break;
      }
      case "Call_Me": {
        // 위로 흩뿌린 돈이 팔랑팔랑 떨어진다
        for (let i = 0; i < count(0.7); i++) {
          const a = rand(-Math.PI * 0.85, -Math.PI * 0.15);
          const sp = rand(300, 650);
          this.emit({
            x: palm.x + rand(-s * 0.2, s * 0.2),
            y: palm.y - s * 0.2,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            ay: 520,
            drag: 0.97,
            size: rand(s * 0.22, s * 0.36),
            shape: "emoji",
            emoji: Math.random() < 0.8 ? "💵" : pick(["💰", "🪙", "💎"]),
            rot: rand(-0.6, 0.6),
            vr: rand(-5, 5),
            wobble: rand(2, 4),
            max: rand(1.4, 2.2),
          });
        }
        if (Math.random() < 0.3 * k) {
          this.emit({
            x: palm.x + rand(-s * 0.5, s * 0.5),
            y: palm.y + rand(-s * 0.5, s * 0.3),
            vy: rand(-80, -30),
            size: rand(4, 9),
            color: "#ffe066",
            shape: "star",
            vr: rand(-4, 4),
            max: rand(0.5, 0.9),
          });
        }
        break;
      }
      case "ILoveYou": {
        if (Math.random() < 0.3 * k) {
          this.emit({
            x: palm.x + rand(-s * 0.6, s * 0.6),
            y: palm.y - s * 0.3,
            vx: rand(-30, 30),
            vy: rand(-160, -80),
            drag: 0.995,
            size: rand(s * 0.18, s * 0.38),
            color: pick(["#ff5fa8", "#ff2d6f", "#ff9ccf"]),
            shape: "heart",
            wobble: rand(1.5, 3),
            rot: 0,
            max: rand(1.4, 2.2),
          });
        }
        for (let i = 0; i < count(1); i++) {
          this.emit({
            x: palm.x + rand(-s * 0.5, s * 0.5),
            y: palm.y + rand(-s * 0.5, s * 0.5),
            vy: rand(-60, -20),
            size: rand(4, 9),
            color: "#ffc2e0",
            max: rand(0.5, 1),
          });
        }
        break;
      }
    }
  }

  update(dt: number) {
    this.time += dt;
    const ps = this.particles;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      if (p.orbit) {
        const o = p.orbit;
        o.angle += o.speed * dt * (1 + (1 - p.life / p.max) * 2);
        o.radius *= Math.pow(0.12, dt);
        p.x = o.cx + Math.cos(o.angle) * o.radius;
        p.y = o.cy + Math.sin(o.angle) * o.radius;
      } else {
        const drag = Math.pow(p.drag, dt * 60);
        p.vx *= drag;
        p.vy = p.vy * drag + p.ay * dt;
        p.x += p.vx * dt + (p.wobble ? Math.sin(this.time * p.wobble * 2 + p.max * 10) * 0.6 : 0);
        p.y += p.vy * dt;
      }
      p.rot += p.vr * dt;
      ps[w++] = p;
    }
    ps.length = w;

    this.bolts = this.bolts.filter((b) => (b.life -= dt) > 0);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.flash = Math.max(0, this.flash - dt * 3);
    this.meteors = this.meteors.filter((m) => {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      for (let i = 0; i < 3; i++) {
        this.emit({
          x: m.x + rand(-m.size * 0.3, m.size * 0.3),
          y: m.y + rand(-m.size * 0.3, m.size * 0.3),
          vx: -m.vx * 0.1 + rand(-30, 30),
          vy: -m.vy * 0.1 + rand(-30, 30),
          drag: 0.94,
          size: rand(m.size * 0.6, m.size * 1.1),
          color: pick(["#fff3a0", "#ffc04a", "#ff7a1a", "#ff3d00"]),
          max: rand(0.3, 0.6),
        });
      }
      if (m.y < m.groundY) return true;
      this.explode(m.x, m.y, m.size);
      return false;
    });
    this.rings = this.rings.filter((r) => {
      r.life -= dt;
      r.r += r.vr * dt;
      r.vr *= Math.pow(0.15, dt);
      return r.life > 0;
    });
  }

  /** 손 주변의 코어 광원 (매 프레임 즉시 그림) */
  drawAura(ctx: CanvasRenderingContext2D, spell: SpellId, hand: HandState, color: string) {
    if (spell === "Cat_Paw") {
      drawCatPaw(ctx, hand, this.time);
      return;
    }
    const pulse = 1 + Math.sin(this.time * 8) * 0.08;
    let pos = hand.palm;
    let radius = hand.size * 1.4;
    if (spell === "Pointing_Up") {
      pos = hand.indexTip;
      radius = hand.size * 0.6;
    } else if (spell === "Victory") {
      pos = { x: (hand.indexTip.x + hand.middleTip.x) / 2, y: (hand.indexTip.y + hand.middleTip.y) / 2 };
      radius = hand.size * 0.8;
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.85;
    const r = radius * pulse;
    ctx.drawImage(glowSprite(color), pos.x - r, pos.y - r, r * 2, r * 2);
    ctx.restore();

    if (spell === "Thumb_Down") {
      // 소용돌이 중심의 어둠
      ctx.save();
      const g = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, hand.size * 0.9);
      g.addColorStop(0, "rgba(0,0,0,0.95)");
      g.addColorStop(0.6, "rgba(20,0,40,0.6)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, hand.size * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    for (const r of this.rings) {
      const t = r.life / r.max;
      ctx.globalAlpha = t;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2 + 10 * t;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const b of this.bolts) {
      const t = b.life / b.max;
      ctx.globalAlpha = t;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (const [width, color] of [
        [14, "rgba(60,140,255,0.35)"],
        [6, "#7cc8ff"],
        [2, "#ffffff"],
      ] as const) {
        ctx.lineWidth = width * b.scale;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(b.points[0].x, b.points[0].y);
        for (let i = 1; i < b.points.length; i++) ctx.lineTo(b.points[i].x, b.points[i].y);
        ctx.stroke();
      }
    }

    for (const p of this.particles) {
      const t = p.life / p.max;
      ctx.globalAlpha = Math.min(1, t * 1.5);
      switch (p.shape) {
        case "glow": {
          const sz = p.size * (0.4 + 0.6 * t);
          ctx.drawImage(glowSprite(p.color), p.x - sz, p.y - sz, sz * 2, sz * 2);
          break;
        }
        case "star":
          ctx.drawImage(glowSprite(p.color), p.x - p.size * 1.5, p.y - p.size * 1.5, p.size * 3, p.size * 3);
          drawShape(ctx, p, starPath);
          break;
        case "heart":
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = Math.min(1, t * 2) * 0.9;
          drawShape(ctx, p, heartPath);
          ctx.globalCompositeOperation = "lighter";
          break;
        case "flake":
          drawFlake(ctx, p);
          break;
        case "plus":
          drawShape(ctx, p, plusPath);
          break;
        case "streak": {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          break;
        }
        case "glyph": {
          const sz = p.size * (1 + (1 - t) * 0.6);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.drawImage(glyphSprite(p.emoji ?? "∞", p.color), -sz, -sz, sz * 2, sz * 2);
          ctx.restore();
          break;
        }
        case "emoji": {
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = Math.min(1, t * 2.5);
          // 날아가면서 점점 커짐
          const sz = p.size * (1 + (1 - t) * 0.8);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.drawImage(emojiSprite(p.emoji ?? "🖕"), -sz, -sz, sz * 2, sz * 2);
          ctx.restore();
          ctx.globalCompositeOperation = "lighter";
          break;
        }
      }
    }
    ctx.restore();
  }

  private explode(x: number, y: number, size: number) {
    for (let i = 0; i < 40; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(150, 600);
      this.emit({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 150,
        ay: 400,
        drag: 0.93,
        size: rand(size * 0.4, size * 1.2),
        color: pick(["#fff3a0", "#ffc04a", "#ff7a1a", "#ff3d00"]),
        max: rand(0.4, 0.9),
      });
    }
    this.rings.push({ x, y, r: size, vr: size * 25, life: 0.5, max: 0.5, color: "#ffb347" });
    this.shake = Math.min(1, this.shake + 0.5);
    this.flash = Math.max(this.flash, 0.25);
    this.flashColor = "#ff9a3c";
  }

  /**
   * 궁극기 이펙트 파티클 생성. p = 차징 게이지(0~1), t = 발동 후 경과 초
   * w, h = 화면 크기
   */
  ultimate(id: UltimateId, stage: UltStage, c: Vec, size: number, p: number, t: number, dt: number, w: number, h: number) {
    const k = Math.min(dt * 60, 3);
    const far = Math.hypot(w, h) * 0.6;

    if (id === "infinite_void") {
      if (stage === "charge") {
        // 손으로 빛이 빨려 들어간다
        for (let i = 0; i < Math.round((2 + p * 6) * k); i++) {
          this.emit({
            x: c.x,
            y: c.y,
            size: rand(2, 6),
            color: pick(["#ffffff", "#b9d8ff", "#b18cff"]),
            max: rand(0.6, 1),
            orbit: { cx: c.x, cy: c.y, angle: rand(0, Math.PI * 2), radius: rand(size * 1.2, size * 3), speed: rand(3, 6) },
          });
        }
        return;
      }
      if (t > 5.8) return;
      const ringR = size * 0.2;
      // 원에서 충격파가 주기적으로 퍼진다
      this.voidRingTimer -= dt;
      if (this.voidRingTimer <= 0 && t > 0.8) {
        this.voidRingTimer = 0.9;
        this.rings.push({ x: c.x, y: c.y, r: ringR, vr: ringR * 3, life: 1.1, max: 1.1, color: "#d9e6ff" });
      }
      // 원 주위로 빛 입자가 소용돌이치며 빨려 들어간다 (나선 은하)
      if (t > 0.5) {
        for (let i = 0; i < Math.round(4 * k); i++) {
          this.emit({
            x: c.x,
            y: c.y,
            size: rand(1.5, 4.5),
            color: pick(["#ffffff", "#b9d8ff", "#c7a6ff", "#8fe8ff"]),
            max: rand(1, 1.6),
            orbit: { cx: c.x, cy: c.y, angle: rand(0, Math.PI * 2), radius: rand(ringR * 1.4, ringR * 3.2), speed: rand(1, 1.8) },
          });
        }
      }
      // 원 가장자리에서 무한한 정보(글자)가 쏟아진다
      if (t > 0.6) {
        for (let i = 0; i < Math.round(2.5 * k); i++) {
          const a = rand(0, Math.PI * 2);
          const sp = rand(90, 260);
          this.emit({
            x: c.x + Math.cos(a) * ringR * 1.05,
            y: c.y + Math.sin(a) * ringR * 1.05,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            drag: 1.015,
            size: rand(9, 22),
            color: pick(["#b9d8ff", "#c7a6ff", "#ffffff", "#8fe8ff"]),
            shape: "glyph",
            emoji: pick(VOID_GLYPHS),
            rot: rand(-0.3, 0.3),
            vr: rand(-0.8, 0.8),
            max: rand(1.2, 2.2),
          });
        }
      }
      // 워프: 화면 중심에서 빛줄기가 사방으로 쏟아진다
      for (let i = 0; i < Math.round(6 * k); i++) {
        const a = rand(0, Math.PI * 2);
        const r = rand(10, far * 0.15);
        const sp = rand(80, 220);
        this.emit({
          x: c.x + Math.cos(a) * r,
          y: c.y + Math.sin(a) * r,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          drag: 1.045,
          size: rand(1, 2.8),
          color: pick(["#ffffff", "#ffffff", "#b9d8ff", "#c7a6ff"]),
          shape: "streak",
          max: rand(0.9, 1.5),
        });
      }
      return;
    }

    if (id === "blackhole") {
      const n = stage === "charge" ? 2 + p * 6 : 14;
      for (let i = 0; i < Math.round(n * k); i++) {
        this.emit({
          x: c.x,
          y: c.y,
          size: rand(3, stage === "charge" ? 8 : 14),
          color: pick(["#a66bff", "#ff6ad5", "#6ad1ff", "#ffffff"]),
          max: rand(0.8, 1.4),
          orbit: {
            cx: c.x,
            cy: c.y,
            angle: rand(0, Math.PI * 2),
            radius: stage === "charge" ? rand(size * 1.5, size * 3) : rand(far * 0.4, far),
            speed: rand(2, 4),
          },
        });
      }
      if (stage === "release") this.shake = Math.max(this.shake, 0.25);
      return;
    }

    if (id === "thunder") {
      if (stage === "charge") {
        if (Math.random() < (0.15 + p * 0.5) * k) {
          const a = rand(-Math.PI * 0.9, -Math.PI * 0.1);
          const len = rand(size * 1.5, size * 3);
          const to = { x: c.x + Math.cos(a) * len, y: c.y + Math.sin(a) * len };
          this.bolts.push({ points: makeBolt(c, to, len * 0.25), life: 0.15, max: 0.15, scale: 1 });
        }
        // 하늘이 우르릉
        if (p > 0.5 && Math.random() < 0.05 * k) {
          const x = rand(0, w);
          this.bolts.push({ points: makeBolt({ x, y: 0 }, { x: x + rand(-80, 80), y: h * rand(0.15, 0.3) }, 40), life: 0.2, max: 0.2, scale: 0.6 });
        }
        return;
      }
      this.strikeTimer -= dt;
      if (this.strikeTimer <= 0 && t < 3.2) {
        this.strikeTimer = rand(0.08, 0.22);
        const target = Math.random() < 0.35 ? { x: c.x + rand(-size, size), y: c.y } : { x: rand(w * 0.05, w * 0.95), y: h * rand(0.75, 1) };
        const from = { x: target.x + rand(-w * 0.15, w * 0.15), y: -20 };
        const pts = makeBolt(from, target, Math.max(60, h * 0.12));
        this.bolts.push({ points: pts, life: 0.3, max: 0.3, scale: 2.2 });
        // 갈래 번개
        const mid = pts[(pts.length * rand(0.3, 0.6)) | 0];
        this.bolts.push({ points: makeBolt(mid, { x: mid.x + rand(-200, 200), y: mid.y + rand(80, 220) }, 50), life: 0.25, max: 0.25, scale: 1 });
        for (let i = 0; i < 18; i++) {
          this.emit({
            x: target.x,
            y: target.y,
            vx: rand(-400, 400),
            vy: rand(-500, -50),
            ay: 900,
            drag: 0.95,
            size: rand(4, 12),
            color: pick(["#9fd8ff", "#ffffff", "#4aa8ff"]),
            max: rand(0.3, 0.7),
          });
        }
        this.flash = 0.7;
        this.flashColor = "#cfeaff";
        this.shake = Math.min(1, this.shake + 0.6);
      }
      return;
    }

    // meteor
    if (stage === "charge") {
      for (let i = 0; i < Math.round((2 + p * 5) * k); i++) {
        const a = rand(0, Math.PI * 2);
        const r = rand(size * 1.5, size * 3);
        this.emit({
          x: c.x + Math.cos(a) * r,
          y: c.y + Math.sin(a) * r,
          vx: -Math.cos(a) * r * 2.2,
          vy: -Math.sin(a) * r * 2.2,
          drag: 0.96,
          size: rand(4, 10),
          color: pick(["#ffc04a", "#ff7a1a", "#fff3a0"]),
          max: rand(0.35, 0.5),
        });
      }
      return;
    }
    this.meteorTimer -= dt;
    if (this.meteorTimer <= 0 && t < 3) {
      this.meteorTimer = rand(0.08, 0.2);
      const size = rand(14, 34);
      const sp = rand(700, 1100);
      const a = rand(Math.PI * 0.6, Math.PI * 0.72);
      this.meteors.push({
        x: rand(w * 0.2, w * 1.3),
        y: -60,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        size,
        groundY: h * rand(0.55, 0.95),
      });
    }
  }

  /**
   * 파티클 아래에 깔리는 궁극기 배경 (무량공처의 우주 공간).
   * origin = 시전한 손 위치. 어둠이 거기서부터 원형으로 퍼져 화면을 덮는다
   */
  drawBackdrop(ctx: CanvasRenderingContext2D, id: UltimateId, stage: UltStage, t: number, w: number, h: number, dur: number, origin: Vec) {
    if (id !== "infinite_void" || stage !== "release") {
      this.voidOrigin = null;
      this.voidFlashed = false;
      this.voidPrevT = -1;
      return;
    }
    this.voidOrigin ??= { ...origin };
    const o = this.voidOrigin;
    const alpha = Math.min(1, Math.max(0, (dur - t) / 0.8));
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.hypot(w, h) / 2;

    // 영역 확장: 손에서부터 원형으로 퍼짐
    const reach = Math.max(Math.hypot(o.x, o.y), Math.hypot(w - o.x, o.y), Math.hypot(o.x, h - o.y), Math.hypot(w - o.x, h - o.y));
    const expand = 1 - Math.pow(1 - Math.min(1, t / 0.7), 3);
    const rExp = reach * 1.02 * expand;

    ctx.save();
    ctx.beginPath();
    ctx.arc(o.x, o.y, Math.max(1, rExp), 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, "rgba(10,6,40,0.97)");
    g.addColorStop(0.35, "rgba(30,16,90,0.92)");
    g.addColorStop(0.7, "rgba(14,8,50,0.95)");
    g.addColorStop(1, "rgba(0,0,0,0.98)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = "lighter";
    // 성운
    const nebula = ["#5a3dff", "#2f7bff", "#b14dff", "#3dd6ff"];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + t * 0.08;
      const r = R * (0.45 + 0.15 * Math.sin(i * 2.1 + t * 0.5));
      const s = R * 0.6;
      ctx.globalAlpha = alpha * 0.3;
      ctx.drawImage(glowSprite(nebula[i % nebula.length]), cx + Math.cos(a) * r - s, cy + Math.sin(a) * r - s, s * 2, s * 2);
    }

    // 원 뒤에서 뻗는 빛줄기 (후광)
    const rays = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.18, cx, cy, R * 1.1);
    rays.addColorStop(0, "rgba(220,235,255,0.55)");
    rays.addColorStop(0.4, "rgba(170,150,255,0.18)");
    rays.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rays;
    ctx.globalAlpha = alpha * Math.min(1, Math.max(0, (t - 0.5) / 0.8));
    ctx.beginPath();
    const beams = 20;
    for (let i = 0; i < beams; i++) {
      const a = (i / beams) * Math.PI * 2 + t * 0.12;
      const wd = 0.035 + 0.025 * Math.sin(i * 3.7 + t * 2);
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a - wd) * R * 1.2, cy + Math.sin(a - wd) * R * 1.2);
      ctx.lineTo(cx + Math.cos(a + wd) * R * 1.2, cy + Math.sin(a + wd) * R * 1.2);
      ctx.closePath();
    }
    ctx.fill();

    // 별: 바깥으로 날아가는 워프
    if (this.voidStars.length === 0) {
      for (let i = 0; i < 280; i++) {
        this.voidStars.push({ a: rand(0, Math.PI * 2), r: Math.random(), size: rand(0.6, 2.4), tw: rand(0, Math.PI * 2) });
      }
    }
    ctx.strokeStyle = "#ffffff";
    ctx.lineCap = "round";
    for (const st of this.voidStars) {
      const rr = (st.r + t * (0.12 + st.size * 0.06)) % 1;
      const d1 = R * (0.08 + rr * rr);
      const d0 = d1 * 0.9;
      const ca = Math.cos(st.a);
      const sa = Math.sin(st.a);
      ctx.globalAlpha = alpha * Math.min(1, rr * 3) * (0.6 + 0.4 * Math.sin(this.time * 4 + st.tw));
      ctx.lineWidth = st.size * (0.4 + rr * 1.4);
      ctx.beginPath();
      ctx.moveTo(cx + ca * d0, cy + sa * d0);
      ctx.lineTo(cx + ca * d1, cy + sa * d1);
      ctx.stroke();
    }
    ctx.restore();

    // 퍼지는 경계의 흰 빛
    if (t < 0.9) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 1 - t / 0.9;
      ctx.strokeStyle = "#ffffff";
      ctx.shadowColor = "#b9d8ff";
      ctx.shadowBlur = 30;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(o.x, o.y, Math.max(1, rExp), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** 궁극기 중심부 (파티클 위에 즉시 그림). dur = 발동 지속 시간(초) */
  drawUltimate(ctx: CanvasRenderingContext2D, id: UltimateId, stage: UltStage, c: Vec, size: number, p: number, t: number, dur = 3.8, w = 0, h = 0) {
    const fade = stage === "release" ? Math.min(1, Math.max(0, (dur - t) / 0.6)) : 1;
    ctx.save();
    if (id === "infinite_void") {
      if (stage === "charge") {
        // 손에 작은 검은 구체가 맺히고 빛 고리가 돈다
        const r = size * (0.12 + p * 0.25);
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.9;
        const halo = r * 4;
        ctx.drawImage(glowSprite("#b9d8ff"), c.x - halo, c.y - halo, halo * 2, halo * 2);
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = Math.max(1.5, r * 0.12);
        ctx.stroke();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = "rgba(185,216,255,0.9)";
        ctx.lineWidth = 2;
        ctx.setLineDash([r * 0.5, r * 0.35]);
        ctx.lineDashOffset = -this.time * r * 3;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r * (1.8 + p * 0.6), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // 흰 빛 테두리를 두른 거대한 검은 원 (size = 화면 짧은 변). 끝날 땐 한 점으로 수축
        const open = 1 - Math.pow(1 - Math.min(1, Math.max(0, (t - 0.3) / 0.9)), 3);
        const close = Math.min(1, Math.max(0, (dur - 0.15 - t) / 0.6));
        const R = size * 0.2 * open * close * close * (1 + Math.sin(this.time * 2) * 0.015);
        if (t > dur - 0.3 && !this.voidFlashed) {
          this.voidFlashed = true;
          this.flash = 1;
          this.flashColor = "#ffffff";
        }
        if (R > 0.5) {
          ctx.globalCompositeOperation = "lighter";
          const halo = R * 2.8;
          ctx.globalAlpha = 0.9;
          ctx.drawImage(glowSprite("#8fb8ff"), c.x - halo, c.y - halo, halo * 2, halo * 2);
          // 가로 렌즈 플레어 + 빛 번짐 잔상
          if (w) {
            ctx.globalAlpha = 0.55 * open * close;
            ctx.drawImage(glowSprite("#6fa8ff"), 0, c.y - R * 0.09, w, R * 0.18);
            ctx.globalAlpha = 0.7 * open * close;
            ctx.drawImage(glowSprite("#ffffff"), c.x - w * 0.3, c.y - R * 0.03, w * 0.6, R * 0.06);
            const ghosts: [number, number, string][] = [
              [0.45, 0.18, "#7f9cff"],
              [0.8, 0.1, "#c78cff"],
              [1.25, 0.25, "#6fe0ff"],
              [1.6, 0.07, "#ffffff"],
            ];
            for (const [d, sz, col] of ghosts) {
              const gx = c.x + (w * 0.85 - c.x) * d * 0.6;
              const gy = c.y + (h * 0.12 - c.y) * d * 0.6;
              const gs = R * sz * 2;
              ctx.globalAlpha = 0.22 * open * close;
              ctx.drawImage(glowSprite(col), gx - gs, gy - gs, gs * 2, gs * 2);
            }
            ctx.globalAlpha = 1;
          }
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
          ctx.fill();
          // 색수차 테두리 (빨강·파랑 번짐)
          ctx.globalCompositeOperation = "lighter";
          ctx.lineWidth = Math.max(2, R * 0.05);
          for (const [dx, col] of [
            [-R * 0.018, "rgba(255,60,140,0.7)"],
            [R * 0.018, "rgba(60,200,255,0.7)"],
          ] as const) {
            ctx.strokeStyle = col;
            ctx.beginPath();
            ctx.arc(c.x + dx, c.y, R * 1.01, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.globalCompositeOperation = "source-over";
          ctx.beginPath();
          ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
          ctx.shadowColor = "#ffffff";
          ctx.shadowBlur = R * 0.4;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = Math.max(2, R * 0.075);
          ctx.stroke();
          ctx.shadowBlur = 0;
          // 테두리를 따라 도는 빛
          ctx.globalCompositeOperation = "lighter";
          for (let i = 0; i < 3; i++) {
            const a = this.time * (1.2 + i * 0.4) + (i * Math.PI * 2) / 3;
            const s = R * 0.35;
            ctx.drawImage(glowSprite("#ffffff"), c.x + Math.cos(a) * R - s, c.y + Math.sin(a) * R - s, s * 2, s * 2);
          }
          ctx.strokeStyle = "rgba(190,170,255,0.8)";
          ctx.lineWidth = Math.max(1, R * 0.02);
          ctx.beginPath();
          ctx.arc(c.x, c.y, R * 1.13, 0, Math.PI * 2);
          ctx.stroke();
        }
        // 한자가 찍힐 때마다 쿵: 흔들림 + 섬광 + 충격파
        for (const cue of [...VOID_CUES.ryoiki, ...VOID_CUES.muryo]) {
          if (this.voidPrevT < cue && t >= cue) {
            const big = VOID_CUES.muryo.includes(cue);
            this.shake = Math.min(1, this.shake + (big ? 0.55 : 0.3));
            this.flash = Math.max(this.flash, big ? 0.35 : 0.18);
            this.flashColor = "#cfe0ff";
            this.rings.push({ x: c.x, y: c.y, r: size * 0.2, vr: size * (big ? 1.6 : 1), life: 0.6, max: 0.6, color: "#ffffff" });
          }
        }
        this.voidPrevT = t;

        // 비네트
        if (w && h) {
          ctx.globalCompositeOperation = "source-over";
          const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
          vg.addColorStop(0, "rgba(0,0,0,0)");
          vg.addColorStop(1, `rgba(0,0,0,${0.7 * fade})`);
          ctx.globalAlpha = 1;
          ctx.fillStyle = vg;
          ctx.fillRect(0, 0, w, h);
        }

        // 시네마틱 레터박스
        if (w && h) {
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = 1;
          const bar = h * 0.09 * Math.min(1, t / 0.5) * Math.min(1, Math.max(0, (dur - t) / 0.5));
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, w, bar);
          ctx.fillRect(0, h - bar, w, bar);
          // 음성에 맞춰 한 글자씩: 위 領域展開, 아래 無量空処
          const textFade = Math.min(1, Math.max(0, (dur - 0.3 - t) / 0.5));
          const unit = Math.min(w, h);
          drawKanjiLine(ctx, "領域展開", VOID_CUES.ryoiki, t, w / 2, h * 0.17, unit * 0.075, textFade);
          drawKanjiLine(ctx, "無量空処", VOID_CUES.muryo, t, w / 2, h * 0.84, unit * 0.13, textFade);
        }
      }
    } else if (id === "blackhole") {
      const r = stage === "charge" ? size * (0.15 + p * 0.35) : size * (0.5 + Math.min(t, 1) * 1.3) * fade;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.9;
      const glow = r * 3.5;
      ctx.drawImage(glowSprite("#a66bff"), c.x - glow, c.y - glow, glow * 2, glow * 2);
      // 강착 원반
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = ["#ff6ad5", "#a66bff", "#ffd2ff"][i];
        ctx.lineWidth = Math.max(1.5, r * (0.18 - i * 0.04));
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, r * (1.7 + i * 0.35), r * (0.45 + i * 0.1), this.time * (1.5 + i * 0.6), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r * 1.1);
      g.addColorStop(0, "#000");
      g.addColorStop(0.8, "#000");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * 1.1, 0, Math.PI * 2);
      ctx.fill();
    } else if (id === "thunder") {
      const r = size * (0.5 + p * 0.9) * (stage === "release" ? 1.4 * fade : 1);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.6 + Math.random() * 0.4;
      ctx.drawImage(glowSprite("#7cc8ff"), c.x - r, c.y - r, r * 2, r * 2);
    } else {
      const r = stage === "charge" ? size * (0.4 + p * 0.9) : size * 1.3 * fade;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.95;
      const pulse = 1 + Math.sin(this.time * 14) * 0.06;
      ctx.drawImage(glowSprite("#ff7a1a"), c.x - r * pulse, c.y - r * pulse, r * 2 * pulse, r * 2 * pulse);
    }
    ctx.restore();

    // 운석 머리
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const m of this.meteors) {
      const r = m.size * 2.2;
      ctx.drawImage(glowSprite("#ffc04a"), m.x - r, m.y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  clear() {
    this.particles = [];
    this.bolts = [];
    this.rings = [];
    this.meteors = [];
  }
}

/** 손 위에 덮어 그리는 고양이 발 (손목 → 손가락 방향으로 회전) */
function drawCatPaw(ctx: CanvasRenderingContext2D, hand: HandState, time: number) {
  const s = hand.size;
  const angle = Math.atan2(hand.palm.y - hand.wrist.y, hand.palm.x - hand.wrist.x) + Math.PI / 2;
  const squish = 1 + Math.sin(time * 10) * 0.03;
  ctx.save();
  ctx.translate(hand.palm.x, hand.palm.y);
  ctx.rotate(angle);
  ctx.scale(squish, 2 - squish);

  // 털 (발 전체)
  ctx.fillStyle = "#fff4ea";
  ctx.strokeStyle = "#e9c9b3";
  ctx.lineWidth = Math.max(2, s * 0.04);
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.15, s * 0.95, s * 1.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 발톱
  const toes = [
    { x: -s * 0.55, y: -s * 0.55 },
    { x: -s * 0.2, y: -s * 0.82 },
    { x: s * 0.2, y: -s * 0.82 },
    { x: s * 0.55, y: -s * 0.55 },
  ];
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#cfc3bb";
  ctx.lineWidth = Math.max(1, s * 0.02);
  for (const t of toes) {
    const dir = Math.atan2(t.y + s * 0.1, t.x);
    const tipX = t.x + Math.cos(dir) * s * 0.42;
    const tipY = t.y + Math.sin(dir) * s * 0.42;
    const nx = -Math.sin(dir) * s * 0.07;
    const ny = Math.cos(dir) * s * 0.07;
    ctx.beginPath();
    ctx.moveTo(t.x + nx, t.y + ny);
    ctx.quadraticCurveTo(tipX + nx * 0.6, tipY + ny * 0.6, tipX, tipY);
    ctx.lineTo(t.x - nx, t.y - ny);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // 젤리 (발바닥)
  ctx.fillStyle = "#ff9fbb";
  for (const t of toes) {
    ctx.beginPath();
    ctx.ellipse(t.x * 0.95, t.y * 0.95 + s * 0.05, s * 0.17, s * 0.21, Math.atan2(t.y, t.x) + Math.PI / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.28);
  ctx.bezierCurveTo(s * 0.5, -s * 0.32, s * 0.55, s * 0.32, 0, s * 0.3);
  ctx.bezierCurveTo(-s * 0.55, s * 0.32, -s * 0.5, -s * 0.32, 0, -s * 0.28);
  ctx.fill();

  // 젤리 하이라이트
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.ellipse(-s * 0.15, -s * 0.1, s * 0.09, s * 0.05, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 한 글자씩 "쾅" 하고 찍히는 한자 줄. cues = 글자별 등장 시각(초) */
function drawKanjiLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  cues: number[],
  t: number,
  cx: number,
  cy: number,
  size: number,
  fade: number,
) {
  const chars = [...text];
  const gap = size * 1.12;
  ctx.save();
  ctx.font = `900 ${size}px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  chars.forEach((ch, i) => {
    const since = t - cues[i];
    if (since < 0) return;
    const pop = Math.min(1, since / 0.18);
    const scale = 1 + (1 - pop) * 0.9;
    const x = cx + (i - (chars.length - 1) / 2) * gap;
    ctx.save();
    ctx.translate(x, cy);
    ctx.scale(scale, scale);
    ctx.globalAlpha = pop * fade;
    ctx.shadowColor = "#9fc4ff";
    ctx.shadowBlur = size * (0.25 + (1 - pop) * 0.8);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(ch, 0, 0);
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1, size * 0.02);
    ctx.strokeStyle = "rgba(20,10,60,0.8)";
    ctx.strokeText(ch, 0, 0);
    ctx.restore();
  });
  ctx.restore();
}

function drawShape(ctx: CanvasRenderingContext2D, p: Particle, path: (ctx: CanvasRenderingContext2D, s: number) => void) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.fillStyle = p.color;
  ctx.beginPath();
  path(ctx, p.size);
  ctx.fill();
  ctx.restore();
}

function starPath(ctx: CanvasRenderingContext2D, s: number) {
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? s : s * 0.25;
    const a = (i / 8) * Math.PI * 2;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
}

function heartPath(ctx: CanvasRenderingContext2D, s: number) {
  ctx.moveTo(0, s * 0.35);
  ctx.bezierCurveTo(-s * 1.1, -s * 0.4, -s * 0.5, -s * 1.1, 0, -s * 0.5);
  ctx.bezierCurveTo(s * 0.5, -s * 1.1, s * 1.1, -s * 0.4, 0, s * 0.35);
  ctx.closePath();
}

function plusPath(ctx: CanvasRenderingContext2D, s: number) {
  const w = s * 0.3;
  ctx.rect(-w, -s, w * 2, s * 2);
  ctx.rect(-s, -w, s * 2, w * 2);
}

function drawFlake(ctx: CanvasRenderingContext2D, p: Particle) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.strokeStyle = p.color;
  ctx.lineWidth = Math.max(1.2, p.size * 0.12);
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const cx = Math.cos(a);
    const sy = Math.sin(a);
    ctx.moveTo(0, 0);
    ctx.lineTo(cx * p.size, sy * p.size);
    // 가지
    const bx = cx * p.size * 0.55;
    const by = sy * p.size * 0.55;
    const b = p.size * 0.3;
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + Math.cos(a + 0.7) * b, by + Math.sin(a + 0.7) * b);
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + Math.cos(a - 0.7) * b, by + Math.sin(a - 0.7) * b);
  }
  ctx.stroke();
  ctx.restore();
}
