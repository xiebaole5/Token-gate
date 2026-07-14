import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import type { UsageRecord } from '../lib/types';
import { fmtUsd } from '../lib/pricing';
import { IconGate } from './icons';

// 五声音阶频率（C major pentatonic，跨两个八度），天然悦耳不刺耳
const PENTATONIC = [
  261.63, 293.66, 329.63, 392.0, 440.0, // C4 D4 E4 G4 A4
  523.25, 587.33, 659.25, 783.99, 880.0, // C5 D5 E5 G5 A5
];

interface Note {
  freq: number;
  gain: number; // 0-1 力度
  tokens: number;
  cost: number;
  model: string;
  at: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 0-1 剩余生命
  maxLife: number;
  size: number;
  hue: number; // emerald 色相微调
}

const EMERALD = '#10b981';
const EMERALD_BRIGHT = '#34d399';

export function MusicBox({ records }: { records: UsageRecord[] }) {
  const [mode, setMode] = useState<'ai' | 'token'>('ai');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const playheadRef = useRef(0); // 当前播放到第几个音符
  const rafRef = useRef<number>(0);
  const lastNoteTimeRef = useRef(0);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const volumeRef = useRef(0.5);
  const canvasSizeRef = useRef({ w: 0, h: 0 });

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(0.5);
  const [progress, setProgressState] = useState(0); // 0-1
  const [noteIdx, setNoteIdx] = useState(0);
  const [currentPeak, setCurrentPeak] = useState(0);
  const progressRef = useRef(0);

  // 同步 ref
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  // 把 records 映射成音符序列（按时间正序）
  const notes = useMemo<Note[]>(() => {
    if (records.length === 0) return [];
    const sorted = [...records].sort((a, b) => (a.at < b.at ? -1 : 1));
    const maxTokens = Math.max(...sorted.map((r) => r.inputTokens + r.outputTokens), 1);
    const maxCost = Math.max(...sorted.map((r) => r.costUsd), 0.001);
    return sorted.map((r) => {
      const tokens = r.inputTokens + r.outputTokens;
      // 对数缩放，避免极端值压扁音阶
      const tokenRatio = Math.log(tokens + 1) / Math.log(maxTokens + 1);
      const idx = Math.min(PENTATONIC.length - 1, Math.floor(tokenRatio * PENTATONIC.length));
      return {
        freq: PENTATONIC[idx],
        gain: Math.min(1, Math.max(0.15, r.costUsd / maxCost)),
        tokens,
        cost: r.costUsd,
        model: r.model,
        at: r.at,
      };
    });
  }, [records]);

  const totalTokens = useMemo(
    () => records.reduce((a, r) => a + r.inputTokens + r.outputTokens, 0),
    [records],
  );

  // 初始化 AudioContext（必须在用户交互后）
  const ensureAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current.state === 'suspended') {
      void audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  // 播放单个音符 + 触发粒子
  const playNote = useCallback((note: Note, cx: number, viewH: number) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // 按模型分配音色（波形）
    if (note.model.includes('reason')) osc.type = 'triangle';
    else if (note.model.includes('claude')) osc.type = 'sine';
    else osc.type = 'sine';

    osc.frequency.value = note.freq;

    // ADSR 包络：柔和起音，自然衰减
    const peak = note.gain * volumeRef.current * 0.5;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.85);

    // 触发萤火虫粒子：从音高对应的 Y 位置生成
    const noteIdxLocal = PENTATONIC.indexOf(note.freq);
    const yRatio = 1 - noteIdxLocal / (PENTATONIC.length - 1); // 高音在上
    const baseY = viewH * (0.15 + yRatio * 0.7);
    const count = 5 + Math.floor(note.gain * 8);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 0.3 + Math.random() * 1.4;
      particlesRef.current.push({
        x: cx,
        y: baseY,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 0.4, // 略微上浮
        life: 1,
        maxLife: 1.2 + Math.random() * 1.5,
        size: 1.5 + Math.random() * 3,
        hue: Math.random(),
      });
    }
  }, []);

  // Canvas 高 DPI 适配
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);
    canvasSizeRef.current = { w: rect.width, h: rect.height };
  }, []);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [resizeCanvas]);

  function setProgress(value: number) {
    progressRef.current = value;
    setProgressState(value);
  }

  // 渲染循环：更新粒子 + 绘制
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const { w, h } = canvasSizeRef.current;
      // 拖尾渐隐：半透明黑覆盖
      ctx.fillStyle = 'rgba(10, 12, 15, 0.18)';
      ctx.fillRect(0, 0, w, h);

      // 绘制音阶参考线（极淡）
      ctx.strokeStyle = 'rgba(35, 41, 49, 0.4)';
      ctx.lineWidth = 1;
      for (let i = 0; i < PENTATONIC.length; i++) {
        const yRatio = 1 - i / (PENTATONIC.length - 1);
        const y = h * (0.15 + yRatio * 0.7);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // 播放进度：推进音符
      const now = performance.now();
      const interval = 380 / speedRef.current; // 毫秒/音符
      if (playingRef.current && notes.length > 0) {
        if (now - lastNoteTimeRef.current >= interval) {
          lastNoteTimeRef.current = now;
          const i = playheadRef.current % notes.length;
          const note = notes[i];
          // 播放头 x 位置：按进度均匀分布
          const cx = (i / Math.max(1, notes.length - 1)) * (w * 0.9) + w * 0.05;
          playNote(note, cx, h);
          playheadRef.current = i + 1;
          setNoteIdx(i);
          setProgress(i / Math.max(1, notes.length - 1));
          if (note.tokens > currentPeak) setCurrentPeak(note.tokens);
        }
      }

      // 播放头光柱
      if (notes.length > 0) {
        const headX = (progressRef.current * 0.9 + 0.05) * w;
        const grd = ctx.createLinearGradient(headX - 30, 0, headX + 30, 0);
        grd.addColorStop(0, 'rgba(16,185,129,0)');
        grd.addColorStop(0.5, 'rgba(16,185,129,0.15)');
        grd.addColorStop(1, 'rgba(16,185,129,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(headX - 30, 0, 60, h);
      }

      // 更新并绘制粒子（萤火虫：发光圆点）
      const ps = particlesRef.current;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.008; // 微重力
        p.vx *= 0.99;
        p.life -= 0.016 / p.maxLife;
        if (p.life <= 0) {
          ps.splice(i, 1);
          continue;
        }
        const alpha = p.life * 0.9;
        const color = p.hue > 0.5 ? EMERALD_BRIGHT : EMERALD;
        // 外层光晕
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 4);
        glow.addColorStop(0, `rgba(52, 211, 153, ${alpha * 0.5})`);
        glow.addColorStop(1, 'rgba(52, 211, 153, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 4, 0, Math.PI * 2);
        ctx.fill();
        // 核心亮点
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  const togglePlay = () => {
    if (notes.length === 0) return;
    ensureAudio();
    if (playing) {
      setPlaying(false);
    } else {
      setPlaying(true);
      lastNoteTimeRef.current = 0;
    }
  };

  const reset = () => {
    setPlaying(false);
    playheadRef.current = 0;
    setProgress(0);
    setNoteIdx(0);
    setCurrentPeak(0);
    particlesRef.current = [];
  };

  const currentNote = notes[noteIdx];

  return (
    <div className="musicbox">
      {/* 模式切换 */}
      <div className="mb-mode-switch">
        <button
          className={mode === 'ai' ? 'mb-mode on' : 'mb-mode'}
          onClick={() => setMode('ai')}
        >
          AI 音乐盒
        </button>
        <button
          className={mode === 'token' ? 'mb-mode on' : 'mb-mode'}
          onClick={() => setMode('token')}
        >
          Token 音符盒
        </button>
      </div>

      {mode === 'ai' ? (
        /* AI 音乐盒：iframe 嵌入独立音乐盒应用 */
        <div className="mb-iframe-wrap">
          <iframe
            src="/musicbox/index.html"
            className="mb-iframe"
            title="AI 音乐盒"
            allow="autoplay; microphone"
          />
        </div>
      ) : (
        <>
          <div className="musicbox-head">
            <div className="musicbox-title">
              <h2><IconGate size={20} /> Token 音符盒</h2>
              <p className="muted">
                把每一笔 token 消耗变成一个音符 · token 越多音越高 · 花得越多声越响 · 听见你的钱怎么烧
              </p>
            </div>
        <div className="musicbox-stats">
          <div className="mb-stat">
            <span className="muted">音符总数</span>
            <strong>{notes.length}</strong>
          </div>
          <div className="mb-stat">
            <span className="muted">当前峰值</span>
            <strong className="em">{currentPeak.toLocaleString()}</strong>
          </div>
          <div className="mb-stat">
            <span className="muted">总 token</span>
            <strong>{totalTokens.toLocaleString()}</strong>
          </div>
        </div>
      </div>

      {records.length === 0 ? (
        <div className="musicbox-empty">
          <p className="muted">还没有 token 消耗记录。</p>
          <p className="muted">去「记一笔」录入数据，或启动代理监听，这里就能把你的消耗奏成一首曲子。</p>
        </div>
      ) : (
        <>
          <div className="musicbox-canvas-wrap">
            <canvas ref={canvasRef} className="musicbox-canvas" />
            {currentNote && (
              <div className="musicbox-nowplaying">
                <span className="muted">正在演奏</span>
                <strong>{currentNote.model}</strong>
                <span className="muted">{currentNote.tokens.toLocaleString()} tok · {fmtUsd(currentNote.cost)}</span>
              </div>
            )}
          </div>

          <div className="musicbox-controls">
            <button className="btn-primary mb-play" onClick={togglePlay}>
              {playing ? '暂停' : '播放'}
            </button>
            <button className="btn-ghost" onClick={reset}>重置</button>

            <div className="mb-slider">
              <label className="muted">速度</label>
              <div className="seg">
                {[0.5, 1, 2].map((s) => (
                  <button
                    key={s}
                    className={speed === s ? 'seg-on' : ''}
                    onClick={() => setSpeed(s)}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-slider">
              <label className="muted">音量</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
              />
            </div>

            <div className="mb-progress">
              <div className="mb-progress-bar">
                <div className="mb-progress-fill" style={{ width: `${progress * 100}%` }} />
              </div>
              <span className="muted">{noteIdx + 1} / {notes.length}</span>
            </div>
          </div>
        </>
      )}
      </>
      )}
    </div>
  );
}
