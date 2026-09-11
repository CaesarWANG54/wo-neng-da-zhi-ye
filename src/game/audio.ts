import { publicAssetPath } from "../asset-path";
import type { PossessionPhase } from "./types";

export const AUDIO_ASSET_PATHS = {
  dribble: publicAssetPath("assets/audio/court-dribble.mp3"),
  swish: publicAssetPath("assets/audio/basket-swish.mp3"),
} as const;

type AudioAssetId = keyof typeof AUDIO_ASSET_PATHS;

export interface CourtAudioSnapshot {
  unlocked: boolean;
  ready: boolean;
  ambientPlaying: boolean;
  error?: string;
}

const LIVE_AMBIENCE_PHASES = new Set<PossessionPhase>([
  "SET_OFFENSE",
  "SCREEN_APPROACH",
  "SECOND_DECISION",
  "SHOT_FLIGHT",
  "REBOUND",
  "FASTBREAK",
  "BACKCOURT_ADVANCE",
]);

const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 90;

export function shouldPlayCourtAmbience(input: {
  phase: PossessionPhase;
  paused: boolean;
  hidden: boolean;
  volume: number;
}) {
  return input.volume > 0 && !input.paused && !input.hidden && LIVE_AMBIENCE_PHASES.has(input.phase);
}

export function isSwishEventKind(kind: string, previousKind?: string) {
  if (kind === "MADE_BASKET" && previousKind === "FREE_THROW_MADE") return false;
  return kind === "MADE_BASKET"
    || kind === "SHOT_MADE_AT_HORN"
    || kind === "SHOT_MADE_AND_FOUL"
    || kind === "FREE_THROW_MADE";
}

function getAudioContextConstructor() {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

export class CourtAudioController {
  private context: AudioContext | null = null;
  private buffers = new Map<AudioAssetId, AudioBuffer>();
  private loadPromise: Promise<void> | null = null;
  private unlockPromise: Promise<CourtAudioSnapshot> | null = null;
  private listeners = new Set<(snapshot: CourtAudioSnapshot) => void>();
  private courtSource: AudioBufferSourceNode | null = null;
  private courtGain: GainNode | null = null;
  private activeEffects = new Set<AudioBufferSourceNode>();
  private desiredAmbience = false;
  private pendingSwish = false;
  private volume = 70;
  private unlocked = false;
  private ready = false;
  private error: string | undefined;
  private destroyed = false;

  subscribe(listener: (snapshot: CourtAudioSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): CourtAudioSnapshot {
    return {
      unlocked: this.unlocked,
      ready: this.ready,
      ambientPlaying: Boolean(this.courtSource),
      error: this.error,
    };
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(100, volume));
    if (this.courtGain && this.context) {
      this.courtGain.gain.setTargetAtTime((this.volume / 100) * 0.12, this.context.currentTime, 0.025);
    }
    this.syncAmbience();
  }

  setAmbientEnabled(enabled: boolean) {
    this.desiredAmbience = enabled;
    this.syncAmbience();
  }

  async unlock() {
    if (this.destroyed) return this.snapshot();
    if (this.unlockPromise) {
      if (this.context?.state !== "running") void this.context?.resume().catch(() => undefined);
      return this.unlockPromise;
    }
    this.unlockPromise = this.performUnlock().finally(() => {
      this.unlockPromise = null;
    });
    return this.unlockPromise;
  }

  playUiTone(tone: "tap" | "confirm" = "tap") {
    if (this.volume <= 0 || this.destroyed) return;
    const context = this.ensureContext();
    if (!context) return;
    if (context.state !== "running") void context.resume().catch(() => undefined);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(tone === "confirm" ? 520 : 360, now);
    gain.gain.setValueAtTime(Math.max(0.0001, (this.volume / 100) * 0.035), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (tone === "confirm" ? 0.09 : 0.055));
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + (tone === "confirm" ? 0.09 : 0.055));
  }

  playSwish() {
    if (!this.unlocked || this.destroyed || this.volume <= 0) return;
    if (!this.ready) {
      this.pendingSwish = true;
      return;
    }
    this.playEffect("swish", 0.52, 1);
  }

  destroy() {
    this.destroyed = true;
    this.desiredAmbience = false;
    this.stopAmbience();
    for (const source of this.activeEffects) {
      try { source.stop(); } catch { /* already ended */ }
      source.disconnect();
    }
    this.activeEffects.clear();
    this.listeners.clear();
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = null;
  }

  private async performUnlock() {
    const context = this.ensureContext();
    if (!context) {
      this.error = "此浏览器不支持 Web Audio";
      this.emit();
      return this.snapshot();
    }
    try {
      this.unlocked = true;
      this.emit();
      const resumeAttempt = context.resume().catch(() => undefined);
      await Promise.race([
        resumeAttempt,
        new Promise<void>((resolve) => window.setTimeout(resolve, 400)),
      ]);
      await this.loadAssets(context);
      this.ready = true;
      this.error = undefined;
      this.syncAmbience();
      if (this.pendingSwish) {
        this.pendingSwish = false;
        this.playSwish();
      }
    } catch (error) {
      this.error = "音频载入失败；本场已保持静音，再次点击比赛区域可重试";
    }
    this.emit();
    return this.snapshot();
  }

  private ensureContext() {
    if (this.context) return this.context;
    const AudioContextConstructor = getAudioContextConstructor();
    if (!AudioContextConstructor) return null;
    this.context = new AudioContextConstructor();
    this.context.onstatechange = () => this.syncAmbience();
    this.courtGain = this.context.createGain();
    this.courtGain.gain.value = (this.volume / 100) * 0.12;
    this.courtGain.connect(this.context.destination);
    return this.context;
  }

  private async loadAssets(context: AudioContext) {
    if (!this.loadPromise) {
      this.loadPromise = Promise.all((Object.entries(AUDIO_ASSET_PATHS) as Array<[AudioAssetId, string]>).map(async ([id, path]) => {
        const response = await fetch(path, { credentials: "same-origin", redirect: "error" });
        if (!response.ok) throw new Error(`音频资源不可用：${id}`);
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (contentType && !contentType.includes("audio/mpeg") && !contentType.includes("audio/mp3") && !contentType.includes("application/octet-stream")) {
          throw new Error(`音频类型不受支持：${id}`);
        }
        const encoded = await response.arrayBuffer();
        if (encoded.byteLength <= 0 || encoded.byteLength > MAX_AUDIO_BYTES) throw new Error(`音频大小超限：${id}`);
        const decoded = await context.decodeAudioData(encoded.slice(0));
        if (decoded.duration <= 0 || decoded.duration > MAX_AUDIO_SECONDS || decoded.numberOfChannels > 2) {
          throw new Error(`音频参数超限：${id}`);
        }
        this.buffers.set(id, decoded);
      })).then(() => undefined).catch((error) => {
        // A transient network/decode failure must not poison every later user
        // gesture. Keep the game playable in silence and permit a clean retry.
        this.loadPromise = null;
        this.buffers.clear();
        throw error;
      });
    }
    await this.loadPromise;
  }

  private syncAmbience() {
    const canPlay = this.desiredAmbience && this.volume > 0 && this.unlocked && this.ready && this.context?.state === "running";
    if (!canPlay) {
      this.stopAmbience();
      return;
    }
    if (this.courtSource) return;
    const buffer = this.buffers.get("dribble");
    if (!buffer || !this.context || !this.courtGain) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.courtGain);
    source.onended = () => {
      if (this.courtSource === source) this.courtSource = null;
      this.emit();
    };
    this.courtSource = source;
    source.start();
    this.emit();
  }

  private stopAmbience() {
    if (this.courtSource) {
      const source = this.courtSource;
      this.courtSource = null;
      try { source.stop(); } catch { /* already ended */ }
      source.disconnect();
    }
    this.emit();
  }

  private playEffect(id: "swish", level: number, playbackRate: number) {
    const context = this.context;
    const buffer = this.buffers.get(id);
    if (!context || !buffer || context.state !== "running") return;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    gain.gain.value = (this.volume / 100) * level;
    source.connect(gain);
    gain.connect(context.destination);
    this.activeEffects.add(source);
    source.onended = () => {
      this.activeEffects.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    source.start();
  }

  private emit() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
