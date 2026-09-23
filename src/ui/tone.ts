import type { Tone } from "../lib/labels";

export const toneText: Record<Tone, string> = {
  neutral: "text-ink-soft",
  accent: "text-accent",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
};

export const toneSoft: Record<Tone, string> = {
  neutral: "bg-track text-ink-soft",
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

export const toneStroke: Record<Tone, string> = {
  neutral: "stroke-ink-faint",
  accent: "stroke-accent",
  ok: "stroke-ok",
  warn: "stroke-warn",
  danger: "stroke-danger",
};

export const toneFill: Record<Tone, string> = {
  neutral: "fill-ink-faint",
  accent: "fill-accent",
  ok: "fill-ok",
  warn: "fill-warn",
  danger: "fill-danger",
};
