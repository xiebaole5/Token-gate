import type { Request, Response } from 'express';
import { addUsage } from './store';
import { emitUsage } from './bus';

/**
 * 音乐生成路由：POST /api/v1/music/generate
 *
 * 请求体：{ idea: string, lyrics?: string, instrumental?: boolean }
 *  - idea: 曲风/灵感描述（必填）
 *  - lyrics: 用户自写歌词（可选；不传且非纯音乐时调用 lyrics_optimizer 自动写词）
 *  - instrumental: 是否纯音乐（默认 false）
 *
 * 响应：mp3 二进制
 *  - Content-Type: audio/mpeg
 *  - X-Music-Duration-Ms: 音频时长（毫秒）
 *  - X-Music-Lyrics: encodeURIComponent 编码的真实歌词（纯音乐时为空）
 *
 * 计量联动：按音频时长估算成本，构造 ProxyUsage emitUsage + 持久化
 */

const MINIMAX_BASE_URL =
  process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com';
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';
const MUSIC_MODEL = process.env.MINIMAX_MUSIC_MODEL || 'music-2.6';

// MiniMax 音乐生成单价：约 ¥0.025/秒 ≈ $0.0035/秒
const COST_PER_SECOND_USD = 0.0035;

interface MiniMaxMusicResponse {
  base_resp?: { status_code?: number; status_msg?: string };
  data?: {
    audio?: string;
    lyrics?: string;
    extra_info?: {
      audio_length?: number;
      audio_sample_rate?: number;
      audio_size?: number;
      stream?: boolean;
      lyrics?: string;
    };
  };
  model?: string;
  id?: string;
}

interface MiniMaxLyricsResponse {
  base_resp?: { status_code?: number; status_msg?: string };
  lyrics?: string;
  song_title?: string;
  style_tags?: string;
  data?: { lyrics?: string };
}

/** 调用 MiniMax 歌词生成 API（lyrics_optimizer），根据灵感自动写词 */
async function generateLyrics(prompt: string): Promise<string> {
  const url = `${MINIMAX_BASE_URL}/v1/lyrics_generation`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MINIMAX_API_KEY}`,
    },
    body: JSON.stringify({
      mode: 'write_full_song',
      prompt,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`歌词生成失败: ${resp.status} ${text}`);
  }
  const json = (await resp.json()) as MiniMaxLyricsResponse;
  if (json.base_resp?.status_code !== 0) {
    throw new Error(`歌词生成错误: ${json.base_resp?.status_msg ?? 'unknown'}`);
  }
  return json.lyrics ?? json.data?.lyrics ?? '';
}

/** 调用 MiniMax 音乐生成 API，返回音频下载 URL + 时长 */
async function generateMusic(
  prompt: string,
  lyrics: string,
  instrumental: boolean,
): Promise<{ audioUrl: string; durationMs: number; model: string; generatedLyrics: string }> {
  const url = `${MINIMAX_BASE_URL}/v1/music_generation`;

  // 照 cocreateos/internal/music/minimax.go：始终传 is_instrumental + lyrics_optimizer + audio_setting
  // 纯音乐：is_instrumental=true, lyrics_optimizer=false, 不传 lyrics
  // 有歌词：is_instrumental=false, lyrics_optimizer=false, 传 lyrics
  // 无歌词：is_instrumental=false, lyrics_optimizer=true, 不传 lyrics（MiniMax 自动写词）
  const useOptimizer = !instrumental && !lyrics;

  const body: Record<string, unknown> = {
    model: MUSIC_MODEL,
    prompt,
    stream: false,
    output_format: 'url',
    is_instrumental: instrumental,
    lyrics_optimizer: useOptimizer,
    audio_setting: {
      sample_rate: 44100,
      bitrate: 256000,
      format: 'mp3',
    },
  };

  // 仅在 lyrics 非空时才加（照参考 line 79-81）
  if (lyrics.trim()) {
    body.lyrics = lyrics;
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MINIMAX_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`音乐生成失败: ${resp.status} ${text}`);
  }

  const json = (await resp.json()) as MiniMaxMusicResponse;
  if (json.base_resp?.status_code !== 0) {
    throw new Error(`音乐生成错误: ${json.base_resp?.status_msg ?? 'unknown'}`);
  }
  const audioUrl = json.data?.audio ?? '';
  const durationMs = json.data?.extra_info?.audio_length ?? 0;
  const generatedLyrics = json.data?.lyrics ?? json.data?.extra_info?.lyrics ?? '';
  if (!audioUrl) throw new Error('MiniMax 未返回音频 URL');

  return { audioUrl, durationMs, model: json.model ?? MUSIC_MODEL, generatedLyrics };
}

/** 下载音频二进制 */
async function downloadAudio(url: string): Promise<Buffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`音频下载失败: ${resp.status}`);
  const ab = await resp.arrayBuffer();
  return Buffer.from(ab);
}

/** 记录一笔 music 生成用量到 TokenGate 账本 */
function recordMusicUsage(
  model: string,
  prompt: string,
  lyrics: string,
  durationMs: number,
  audioBytes: number,
): void {
  // 估算等价 token：input = (prompt + lyrics) 字符 / 3；output = 音频字节 / 100
  const inputTokens = Math.ceil((prompt.length + lyrics.length) / 3);
  const outputTokens = Math.ceil(audioBytes / 100);
  const durationSec = durationMs / 1000;
  const costUsd = Math.round(durationSec * COST_PER_SECOND_USD * 1e6) / 1e6;

  const usage = addUsage({
    providerId: 'minimax-music',
    providerName: 'MiniMax Music',
    model,
    inputTokens,
    outputTokens,
    costUsd,
    stream: false,
  });
  emitUsage(usage);
}

export async function handleMusicGenerate(
  req: Request,
  res: Response,
): Promise<void> {
  const { idea, lyrics, instrumental } = (req.body ?? {}) as {
    idea?: string;
    lyrics?: string;
    instrumental?: boolean;
  };

  if (!idea || typeof idea !== 'string' || idea.trim().length === 0) {
    res.status(400).json({ error: 'idea 必填' });
    return;
  }

  if (!MINIMAX_API_KEY) {
    res.status(503).json({ error: 'MINIMAX_API_KEY 未配置' });
    return;
  }

  const isInstrumental = !!instrumental;
  const userLyrics = typeof lyrics === 'string' ? lyrics.trim() : '';
  const prompt = idea.trim();

  try {
    // 1. 歌词处理：用户没传歌词且非纯音乐 -> 尝试调 lyrics_generation 写词
    //    失败不挡路，置空让 music_generation 的 lyrics_optimizer 兜底
    let finalLyrics = userLyrics;
    if (!isInstrumental && !finalLyrics) {
      try {
        finalLyrics = await generateLyrics(prompt);
      } catch (lyricsErr) {
        console.warn('[music] 歌词生成失败，改用 lyrics_optimizer 兜底:', (lyricsErr as Error).message);
        finalLyrics = '';
      }
    }

    // 2. 调用 MiniMax 音乐生成
    const { audioUrl, durationMs, model, generatedLyrics } = await generateMusic(
      prompt,
      finalLyrics,
      isInstrumental,
    );

    // 如果 API 自动生成了歌词，用它
    if (!finalLyrics && generatedLyrics) {
      finalLyrics = generatedLyrics;
    }

    // 3. 下载音频二进制
    const audioBuffer = await downloadAudio(audioUrl);

    // 4. 计量联动：记录到 TokenGate 账本
    recordMusicUsage(model, prompt, finalLyrics, durationMs, audioBuffer.length);

    // 5. 返回 mp3 二进制 + 响应头
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-Music-Duration-Ms', String(durationMs));
    res.setHeader('X-Music-Lyrics', encodeURIComponent(finalLyrics));
    res.setHeader('X-Music-Model', model);
    res.setHeader('X-Music-Source', 'minimax');
    res.send(audioBuffer);
  } catch (e) {
    const msg = (e as Error).message;
    console.error('[music/generate] 失败:', msg);
    res.status(502).json({ error: msg });
  }
}
