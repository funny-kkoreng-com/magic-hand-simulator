"use client";

import { useEffect } from "react";
import { SPELLS, type SpellId } from "@/lib/spells";
import { ULTIMATES, ULT_RULES, sealIcon, sealLabel, type UltimateView } from "@/lib/ultimates";

interface Props {
  open: boolean;
  onClose: () => void;
  activeIds: SpellId[];
  ultView: UltimateView;
}

export default function GestureGuide({ open, onClose, activeIds, ultView }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-black/40 transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        aria-hidden={!open}
        className={`fixed left-0 top-0 z-40 flex h-full w-[min(360px,88vw)] flex-col border-r border-white/10 bg-[#0d0a1f]/95 text-white shadow-2xl backdrop-blur-md transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold">🪄 마법 주문서</h2>
            <p className="text-xs text-white/50">순서대로 따라 해 보세요</p>
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-white/70 hover:bg-white/10 hover:text-white"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
        <h3 className="mb-2 px-1 text-xs font-bold tracking-widest text-white/50">기본 마법 · 한 손</h3>
        <ol className="space-y-3">
          {SPELLS.map((spell, i) => {
            const active = activeIds.includes(spell.id);
            return (
              <li
                key={spell.id}
                className="rounded-2xl border p-4 transition-colors"
                style={{
                  borderColor: active ? spell.color : "rgba(255,255,255,0.08)",
                  background: active ? `${spell.color}22` : "rgba(255,255,255,0.03)",
                  boxShadow: active ? `0 0 24px ${spell.color}55` : undefined,
                }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-black"
                    style={{ background: spell.color }}
                  >
                    {i + 1}
                  </span>
                  <span className="text-3xl leading-none">{spell.hand}</span>
                  <div className="min-w-0">
                    <div className="text-sm text-white/60">{spell.gestureName}</div>
                    <div className="font-bold">
                      {spell.icon} {spell.spellName}
                    </div>
                  </div>
                  {active && (
                    <span className="ml-auto rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold">
                      시전 중
                    </span>
                  )}
                </div>
                <ol className="mt-3 space-y-1 pl-10 text-sm text-white/75">
                  {spell.steps.map((step, j) => (
                    <li key={j} className="flex gap-2">
                      <span className="text-white/40">{j + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-2 pl-10 text-xs text-white/45">{spell.description}</p>
              </li>
            );
          })}
        </ol>

        <h3 className="mb-1 mt-6 px-1 text-xs font-bold tracking-widest text-white/50">궁극기 · 두 손</h3>
        <p className="mb-3 px-1 text-xs leading-relaxed text-white/50">
          두 손으로 인을 순서대로 맺으세요. 각 인은 {ULT_RULES.sealHoldMs / 1000}초 유지, 다음 인까지{" "}
          {ULT_RULES.sealGapMs / 1000}초 안에! 틀린 인을 맺거나 늦으면 처음부터. 마지막 자세는{" "}
          {ULT_RULES.chargeMs / 1000}초 유지해야 발동하고, 발동 후 {ULT_RULES.cooldownMs / 1000}초 재충전.
        </p>
        <ol className="space-y-3">
          {ULTIMATES.map((u) => {
            const current = ultView.id === u.id && ultView.phase !== "idle" && ultView.phase !== "cooldown";
            return (
              <li
                key={u.id}
                className="rounded-2xl border p-4"
                style={{
                  borderColor: current ? u.color : `${u.color}44`,
                  background: current ? `${u.color}22` : `linear-gradient(135deg, ${u.color}14, transparent)`,
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-3xl leading-none">{u.icon}</span>
                  <div>
                    <div className="font-black" style={{ color: u.color }}>
                      {u.name}
                    </div>
                    <div className="text-xs text-white/50">{u.description}</div>
                  </div>
                </div>
                <ol className="mt-3 space-y-1.5 text-sm text-white/80">
                  {u.seals.map((seal, j) => {
                    const done = current && j < ultView.sealsDone;
                    return (
                      <li key={j} className="flex items-center gap-2">
                        <span
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                          style={{ background: done ? u.color : "rgba(255,255,255,0.12)", color: done ? "#000" : undefined }}
                        >
                          {j + 1}
                        </span>
                        <span className="w-12 shrink-0 text-lg">{sealIcon(seal)}</span>
                        <span className="text-xs">{sealLabel(seal)}</span>
                      </li>
                    );
                  })}
                  <li className="flex items-start gap-2 pt-1">
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-black"
                      style={{ background: u.color }}
                    >
                      ★
                    </span>
                    <span className="text-xs font-semibold" style={{ color: u.color }}>
                      마지막: {u.finalStep}
                    </span>
                  </li>
                </ol>
              </li>
            );
          })}
        </ol>
        </div>

        <footer className="border-t border-white/10 px-5 py-3 text-xs text-white/45">
          💡 손 전체가 화면에 들어오게, 밝은 곳에서 하면 더 잘 인식돼요. 두 손으로 서로 다른 마법도 가능!
        </footer>
      </aside>
    </>
  );
}
