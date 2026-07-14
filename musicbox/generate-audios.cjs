/**
 * generate-demo-audios.js
 * 用 Web Audio API + OfflineAudioContext 合成 3 首示例纯音乐 wav
 * 在 Node.js 环境下用 node 直接跑（需要无外部依赖）
 *
 * 实际上 Node.js 没有 Web Audio API，所以这个脚本用纯数学方式生成 WAV 文件。
 */

const fs = require('fs');
const path = require('path');

const cacheDir = path.join(__dirname, 'cache');

// WAV 文件写入（16-bit PCM）
function writeWav(filename, samples, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }

  fs.writeFileSync(path.join(cacheDir, filename), buffer);
  console.log('写入 ' + filename + ' (' + (dataSize / 1024).toFixed(1) + ' KB)');
}

// 五声音阶频率
const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
const BASS = [130.81, 146.83, 164.81, 196.0, 220.0];

const sampleRate = 44100;

// ADSR 包络
function adsr(t, duration, sr) {
  const attack = 0.02 * sr;
  const decay = 0.1 * sr;
  const sustainLevel = 0.6;
  const release = 0.3 * sr;
  const sample = t;
  if (sample < attack) return sample / attack;
  if (sample < attack + decay) return 1 - (1 - sustainLevel) * (sample - attack) / decay;
  if (sample < duration - release) return sustainLevel;
  if (sample < duration) return sustainLevel * (1 - (sample - (duration - release)) / release);
  return 0;
}

// 生成一首曲子
function generateSong(filename, durationSec, melodyNotes, bassPattern, tempoBpm) {
  const totalSamples = Math.floor(durationSec * sampleRate);
  const samples = new Float32Array(totalSamples);
  const beatDuration = 60 / tempoBpm * sampleRate; // 每拍样本数
  const noteDuration = beatDuration * 0.9; // 略短于一拍

  // 旋律
  let noteIdx = 0;
  for (let pos = 0; pos < totalSamples; pos += noteDuration) {
    const note = melodyNotes[noteIdx % melodyNotes.length];
    noteIdx++;
    const dur = Math.min(noteDuration, totalSamples - pos);
    for (let i = 0; i < dur; i++) {
      const t = pos + i;
      if (t >= totalSamples) break;
      const env = adsr(i, dur, sampleRate);
      // 正弦波 + 轻微泛音
      const fundamental = Math.sin(2 * Math.PI * note * i / sampleRate);
      const harmonic = 0.3 * Math.sin(2 * Math.PI * note * 2 * i / sampleRate);
      samples[t] += 0.3 * env * (fundamental + harmonic);
    }
  }

  // 低音
  let bassIdx = 0;
  const bassNoteDuration = beatDuration * 2; // 低音每两拍换一次
  for (let pos = 0; pos < totalSamples; pos += bassNoteDuration) {
    const note = bassPattern[bassIdx % bassPattern.length];
    bassIdx++;
    const dur = Math.min(bassNoteDuration, totalSamples - pos);
    for (let i = 0; i < dur; i++) {
      const t = pos + i;
      if (t >= totalSamples) break;
      const env = adsr(i, dur, sampleRate) * 0.5;
      samples[t] += 0.2 * env * Math.sin(2 * Math.PI * note * i / sampleRate);
    }
  }

  // 归一化
  let max = 0;
  for (let i = 0; i < totalSamples; i++) {
    if (Math.abs(samples[i]) > max) max = Math.abs(samples[i]);
  }
  if (max > 0) {
    for (let i = 0; i < totalSamples; i++) {
      samples[i] = samples[i] / max * 0.8;
    }
  }

  writeWav(filename, samples, sampleRate);
}

// 曲 1：雨夜钢琴 - 慢速温柔
console.log('生成示例音乐...');
generateSong('demo-1.wav', 30,
  [PENTA[0], PENTA[2], PENTA[4], PENTA[3], PENTA[2], PENTA[0], PENTA[1], PENTA[3]],
  [BASS[0], BASS[0], BASS[3], BASS[3]],
  70
);

// 曲 2：星河漂流 - 中速空灵
generateSong('demo-2.wav', 35,
  [PENTA[5], PENTA[3], PENTA[4], PENTA[2], PENTA[6], PENTA[4], PENTA[3], PENTA[5]],
  [BASS[2], BASS[2], BASS[4], BASS[4]],
  90
);

// 曲 3：海边日出 - 慢速冥想
generateSong('demo-3.wav', 30,
  [PENTA[2], PENTA[0], PENTA[3], PENTA[1], PENTA[4], PENTA[2], PENTA[0], PENTA[3]],
  [BASS[1], BASS[1], BASS[4], BASS[0]],
  60
);

console.log('完成！3 首示例音乐已生成到 cache/ 目录');
