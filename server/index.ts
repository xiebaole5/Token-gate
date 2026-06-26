import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  loadStore,
  listProviders,
  upsertProvider,
  deleteProvider,
  listUsages,
  quotaStatus,
} from './store';
import { handleProxy } from './proxy';
import { usageBus } from './bus';
import { testProvider } from './test';
import { probeLocalModels, resolveButlerProvider, askButler } from './butler';

loadStore();

const app = express();
const PORT = Number(process.env.TOKENGATE_PORT ?? 8787);

app.use(cors({ origin: true }));

// 代理路由要拿原始 body 透传，放在 json 解析之前，单独用 json 解析它的 body
// 这里用 express.json 即可（OpenAI 兼容都是 JSON）
app.use(express.json({ limit: '8mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, port: PORT });
});

// 联调用模拟上游：返回 OpenAI 兼容 chat.completions 形态（含 usage）。
// 可用任意 provider 把 baseUrl 指向 http://127.0.0.1:8787/api/_mock 来演示。
app.post('/api/_mock/v1/chat/completions', (req, res) => {
  const body = (req.body ?? {}) as { model?: string; messages?: { content?: string }[] };
  const userText = body.messages?.map((m) => m.content ?? '').join('') ?? '';
  const inTok = Math.max(20, Math.ceil(userText.length / 3));
  const outTok = 80 + Math.floor(Math.random() * 80);
  res.json({
    id: 'mock-' + Date.now(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? 'mock-model',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: '（mock 回复，用于联调 TokenGate）' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: inTok, completion_tokens: outTok, total_tokens: inTok + outTok },
  });
});

// ---- Provider CRUD（返回不含 key 明文） ----
app.get('/api/providers', (_req, res) => {
  res.json({ providers: listProviders(), quotas: quotaStatus() });
});

app.post('/api/providers', async (req, res) => {
  const { key, autoTest, ...data } = req.body ?? {};
  if (!data.name || !data.baseUrl) {
    res.status(400).json({ error: 'name 和 baseUrl 必填' });
    return;
  }
  const p = upsertProvider(
    {
      id: data.id,
      name: data.name,
      baseUrl: data.baseUrl,
      category: data.category ?? '',
      plan: data.plan ?? '',
      quotaUsd: Number(data.quotaUsd) || 0,
      models: Array.isArray(data.models) ? data.models : [],
    },
    key,
  );
  // 保存即自检（仅在配置了 key 时；可显式关闭）
  let test = undefined;
  if (autoTest !== false && p.hasKey) {
    test = await testProvider(p.id);
  }
  res.json({ provider: p, test });
});

app.post('/api/providers/:id/test', async (req, res) => {
  const r = await testProvider(req.params.id);
  res.json(r);
});

app.delete('/api/providers/:id', (req, res) => {
  deleteProvider(req.params.id);
  res.json({ ok: true });
});

// ---- 用量与额度 ----
app.get('/api/usages', (_req, res) => {
  res.json({ usages: listUsages(), quotas: quotaStatus() });
});

// ---- AI 管家：本地模型探测 ----
app.get('/api/butler/probe', async (_req, res) => {
  const probes = await probeLocalModels();
  res.json({ probes });
});

// ---- 本机 AI 工具扫描：只读已知安装/配置目录是否存在，绝不读取文件内容 ----
interface KnownTool {
  id: string;
  name: string;
  kind: string;
  paths: string[];
  grep?: string;
  suggestBaseUrl: string;
  isLocal?: boolean;
}

const KNOWN_AI_TOOLS: KnownTool[] = [
  // ===== IDE / 代码编辑器（含 AI 功能） =====
  { id: 'cursor', name: 'Cursor', kind: 'editor', paths: ['~/Library/Application Support/Cursor', '~/.cursor', '/Applications/Cursor.app'], suggestBaseUrl: '' },
  { id: 'windsurf', name: 'Windsurf', kind: 'editor', paths: ['~/Library/Application Support/Windsurf', '~/.windsurf', '/Applications/Windsurf.app'], suggestBaseUrl: '' },
  { id: 'trae', name: 'TRAE', kind: 'editor', paths: ['~/Library/Application Support/Trae', '~/.trae', '/Applications/Trae.app', '/Applications/TRAE.app'], suggestBaseUrl: '' },
  { id: 'zed', name: 'Zed', kind: 'editor', paths: ['~/Library/Application Support/Zed', '~/.zed', '/Applications/Zed.app'], suggestBaseUrl: '' },
  { id: 'vscode', name: 'VS Code', kind: 'editor', paths: ['~/Library/Application Support/Code', '~/.vscode', '/Applications/Visual Studio Code.app'], suggestBaseUrl: '' },
  { id: 'vscode-insiders', name: 'VS Code Insiders', kind: 'editor', paths: ['~/Library/Application Support/Code - Insiders', '~/.vscode-insiders'], suggestBaseUrl: '' },
  { id: 'jetbrains-toolbox', name: 'JetBrains Toolbox', kind: 'editor', paths: ['~/Library/Application Support/JetBrains/Toolbox', '/Applications/JetBrains Toolbox.app'], suggestBaseUrl: '' },
  { id: 'jetbrains-ai', name: 'JetBrains AI Assistant', kind: 'editor-ext', paths: ['~/Library/Application Support/JetBrains'], grep: 'AIAssistant', suggestBaseUrl: '' },

  // ===== 编辑器 AI 扩展 =====
  { id: 'cline', name: 'Cline', kind: 'editor-ext', paths: ['~/.vscode/extensions', '~/.cursor/extensions'], grep: 'cline', suggestBaseUrl: '' },
  { id: 'roo-code', name: 'Roo Code', kind: 'editor-ext', paths: ['~/.vscode/extensions', '~/.cursor/extensions'], grep: 'roo', suggestBaseUrl: '' },
  { id: 'continue', name: 'Continue', kind: 'editor-ext', paths: ['~/.continue', '~/.vscode/extensions'], grep: 'continue.continue', suggestBaseUrl: '' },
  { id: 'copilot', name: 'GitHub Copilot', kind: 'editor-ext', paths: ['~/.vscode/extensions'], grep: 'github.copilot', suggestBaseUrl: '' },
  { id: 'codeium', name: 'Codeium', kind: 'editor-ext', paths: ['~/.codeium', '~/.vscode/extensions'], grep: 'codeium', suggestBaseUrl: '' },
  { id: 'tabnine', name: 'Tabnine', kind: 'editor-ext', paths: ['~/.tabnine', '~/Library/Application Support/TabNine'], suggestBaseUrl: '' },
  { id: 'supermaven', name: 'Supermaven', kind: 'editor-ext', paths: ['~/.supermaven', '~/.vscode/extensions'], grep: 'supermaven', suggestBaseUrl: '' },
  { id: 'amazon-q', name: 'Amazon Q Developer', kind: 'editor-ext', paths: ['~/.aws/amazonq', '~/Library/Application Support/amazon-q'], suggestBaseUrl: '' },

  // ===== CLI / 终端工具 =====
  { id: 'aider', name: 'Aider', kind: 'cli', paths: ['~/.aider', '~/.aider.conf.yml', '~/.aider.tags.cache'], suggestBaseUrl: '' },
  { id: 'codex-cli', name: 'Codex CLI', kind: 'cli', paths: ['~/.codex', '~/.openai-codex'], suggestBaseUrl: 'https://api.openai.com' },
  { id: 'claude-code', name: 'Claude Code CLI', kind: 'cli', paths: ['~/.claude', '~/.config/claude-code', '~/.anthropic'], suggestBaseUrl: 'https://api.anthropic.com' },
  { id: 'gemini-cli', name: 'Gemini CLI', kind: 'cli', paths: ['~/.gemini', '~/.config/gemini'], suggestBaseUrl: 'https://generativelanguage.googleapis.com' },
  { id: 'qwen-code', name: 'Qwen Code CLI', kind: 'cli', paths: ['~/.qwen', '~/.qwen-code'], suggestBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'opencode', name: 'OpenCode', kind: 'cli', paths: ['~/.opencode', '~/.config/opencode'], suggestBaseUrl: '' },
  { id: 'mods', name: 'mods (Charm)', kind: 'cli', paths: ['~/.config/mods'], suggestBaseUrl: '' },
  { id: 'fabric', name: 'Fabric (Daniel Miessler)', kind: 'cli', paths: ['~/.config/fabric'], suggestBaseUrl: '' },
  { id: 'shell-gpt', name: 'shell-gpt', kind: 'cli', paths: ['~/.config/shell_gpt'], suggestBaseUrl: '' },
  { id: 'gpt-pilot', name: 'GPT Pilot', kind: 'cli', paths: ['~/.gpt-pilot'], suggestBaseUrl: '' },
  { id: 'sgpt', name: 'sgpt', kind: 'cli', paths: ['~/.config/sgpt'], suggestBaseUrl: '' },

  // ===== 国外 GUI 客户端 =====
  { id: 'claude-desktop', name: 'Claude Desktop', kind: 'gui', paths: ['~/Library/Application Support/Claude', '/Applications/Claude.app'], suggestBaseUrl: '' },
  { id: 'chatgpt-desktop', name: 'ChatGPT Desktop', kind: 'gui', paths: ['~/Library/Application Support/com.openai.chat', '~/Library/Application Support/ChatGPT', '/Applications/ChatGPT.app'], suggestBaseUrl: '' },
  { id: 'perplexity', name: 'Perplexity', kind: 'gui', paths: ['~/Library/Application Support/Perplexity', '/Applications/Perplexity.app'], suggestBaseUrl: '' },
  { id: 'msty', name: 'Msty', kind: 'gui', paths: ['~/Library/Application Support/Msty', '/Applications/Msty.app'], suggestBaseUrl: '' },
  { id: 'librechat', name: 'LibreChat', kind: 'gui', paths: ['~/LibreChat', '~/.librechat'], suggestBaseUrl: '' },
  { id: 'chatbox', name: 'Chatbox', kind: 'gui', paths: ['~/Library/Application Support/xyz.chatboxapp.app', '/Applications/Chatbox.app'], suggestBaseUrl: '' },
  { id: 'cherry-studio', name: 'Cherry Studio', kind: 'gui', paths: ['~/Library/Application Support/CherryStudio', '/Applications/Cherry Studio.app'], suggestBaseUrl: '' },
  { id: 'jan', name: 'Jan', kind: 'gui', paths: ['~/Library/Application Support/Jan', '~/jan', '/Applications/Jan.app'], suggestBaseUrl: 'http://127.0.0.1:1337/v1', isLocal: true },
  { id: 'witsy', name: 'Witsy', kind: 'gui', paths: ['~/Library/Application Support/Witsy', '/Applications/Witsy.app'], suggestBaseUrl: '' },
  { id: 'enchanted', name: 'Enchanted', kind: 'gui', paths: ['~/Library/Containers/com.augustdigital.enchanted', '/Applications/Enchanted.app'], suggestBaseUrl: '' },
  { id: 'lobe-chat', name: 'Lobe Chat', kind: 'gui', paths: ['~/.lobe-chat', '~/Library/Application Support/LobeHub', '/Applications/LobeChat.app'], suggestBaseUrl: '' },
  { id: 'big-agi', name: 'Big-AGI', kind: 'gui', paths: ['~/big-AGI', '~/.big-agi'], suggestBaseUrl: '' },

  // ===== 国内主流 GUI =====
  { id: 'kimi-desktop', name: 'Kimi 桌面版', kind: 'gui', paths: ['~/Library/Application Support/Kimi', '~/Library/Application Support/com.moonshot.kimi', '/Applications/Kimi.app'], suggestBaseUrl: 'https://api.moonshot.cn' },
  { id: 'doubao-desktop', name: '豆包桌面版', kind: 'gui', paths: ['~/Library/Application Support/Doubao', '~/Library/Application Support/com.bytedance.doubao', '/Applications/豆包.app', '/Applications/Doubao.app'], suggestBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { id: 'tongyi-desktop', name: '通义千问桌面版', kind: 'gui', paths: ['~/Library/Application Support/Tongyi', '~/Library/Application Support/com.alibaba.tongyi', '/Applications/通义.app', '/Applications/Tongyi.app'], suggestBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'wenxin-desktop', name: '文心一言桌面版', kind: 'gui', paths: ['~/Library/Application Support/Wenxin', '/Applications/文心一言.app'], suggestBaseUrl: '' },
  { id: 'yuanbao-desktop', name: '腾讯元宝', kind: 'gui', paths: ['~/Library/Application Support/Yuanbao', '/Applications/腾讯元宝.app'], suggestBaseUrl: '' },
  { id: 'glm-desktop', name: '智谱清言', kind: 'gui', paths: ['~/Library/Application Support/ZhipuAI', '/Applications/智谱清言.app'], suggestBaseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'deepseek-desktop', name: 'DeepSeek 桌面版', kind: 'gui', paths: ['~/Library/Application Support/DeepSeek', '/Applications/DeepSeek.app'], suggestBaseUrl: 'https://api.deepseek.com' },
  { id: 'minimax-desktop', name: 'MiniMax / 海螺', kind: 'gui', paths: ['~/Library/Application Support/MiniMax', '~/Library/Application Support/Hailuo', '/Applications/海螺AI.app'], suggestBaseUrl: 'https://api.minimax.chat' },
  { id: 'xinghuo-desktop', name: '讯飞星火', kind: 'gui', paths: ['~/Library/Application Support/SparkDesk', '/Applications/讯飞星火.app'], suggestBaseUrl: '' },
  { id: 'mimo-desktop', name: '小米 MiMo', kind: 'gui', paths: ['~/Library/Application Support/MiMo', '~/Library/Application Support/com.xiaomi.mimo', '/Applications/小米MiMo.app'], suggestBaseUrl: '' },
  { id: 'openclaw', name: 'OpenClaw / Cocreate', kind: 'local-app', paths: ['~/.openclaw', '~/Library/Application Support/openclaw', '/Applications/openclaw.app'], suggestBaseUrl: '' },

  // ===== 本地推理引擎 =====
  { id: 'ollama', name: 'Ollama', kind: 'local-server', paths: ['~/.ollama', '/Applications/Ollama.app'], suggestBaseUrl: 'http://127.0.0.1:11434/v1', isLocal: true },
  { id: 'lm-studio', name: 'LM Studio', kind: 'local-server', paths: ['~/.cache/lm-studio', '~/.lmstudio', '/Applications/LM Studio.app'], suggestBaseUrl: 'http://127.0.0.1:1234/v1', isLocal: true },
  { id: 'mlx', name: 'MLX 模型缓存', kind: 'local-server', paths: ['~/.cache/huggingface/hub', '~/.cache/mlx_community', '~/mlx_models'], suggestBaseUrl: 'http://127.0.0.1:8080/v1', isLocal: true },
  { id: 'llamacpp', name: 'llama.cpp', kind: 'local-server', paths: ['~/.llama.cpp', '~/llama.cpp', '/usr/local/bin/llama-server'], suggestBaseUrl: 'http://127.0.0.1:8080/v1', isLocal: true },
  { id: 'gpt4all', name: 'GPT4All', kind: 'local-server', paths: ['~/Library/Application Support/nomic.ai/GPT4All', '/Applications/GPT4All.app'], suggestBaseUrl: 'http://127.0.0.1:4891/v1', isLocal: true },
  { id: 'koboldcpp', name: 'KoboldCpp', kind: 'local-server', paths: ['~/koboldcpp', '~/.koboldcpp'], suggestBaseUrl: 'http://127.0.0.1:5001/v1', isLocal: true },
  { id: 'vllm', name: 'vLLM', kind: 'local-server', paths: ['~/.cache/vllm', '~/vllm'], suggestBaseUrl: 'http://127.0.0.1:8000/v1', isLocal: true },
  { id: 'text-gen-webui', name: 'text-generation-webui', kind: 'local-server', paths: ['~/text-generation-webui'], suggestBaseUrl: 'http://127.0.0.1:5000/v1', isLocal: true },

  // ===== Hugging Face / 通用模型缓存 =====
  { id: 'hf-cache', name: 'Hugging Face 缓存', kind: 'local-server', paths: ['~/.cache/huggingface'], suggestBaseUrl: '', isLocal: true },
  { id: 'modelscope-cache', name: 'ModelScope 缓存', kind: 'local-server', paths: ['~/.cache/modelscope', '~/.modelscope'], suggestBaseUrl: '', isLocal: true },

  // ===== Agent / 框架配置 =====
  { id: 'langchain', name: 'LangChain 缓存', kind: 'agent', paths: ['~/.cache/langchain', '~/.langchain'], suggestBaseUrl: '' },
  { id: 'autogen', name: 'AutoGen', kind: 'agent', paths: ['~/.autogen', '~/.cache/autogen'], suggestBaseUrl: '' },
  { id: 'crewai', name: 'CrewAI', kind: 'agent', paths: ['~/.crewai'], suggestBaseUrl: '' },
  { id: 'dify', name: 'Dify', kind: 'agent', paths: ['~/dify', '~/.dify'], suggestBaseUrl: '' },
  { id: 'flowise', name: 'Flowise', kind: 'agent', paths: ['~/.flowise'], suggestBaseUrl: '' },
];

function expandHome(p: string): string {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

function existsSafe(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function findGrepSubdir(dir: string, needle: string): string | null {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const lower = needle.toLowerCase();
    for (const e of entries) {
      // 只看目录名做字符串匹配，绝不读文件
      if (e.isDirectory() && e.name.toLowerCase().includes(lower)) {
        return path.join(dir, e.name);
      }
    }
    return null;
  } catch {
    return null;
  }
}

app.get('/api/scan/ai-tools', (_req, res) => {
  const found: {
    id: string;
    name: string;
    kind: string;
    matchedPath: string;
    isLocal: boolean;
    suggestBaseUrl: string;
  }[] = [];
  const missing: { id: string; name: string }[] = [];

  for (const tool of KNOWN_AI_TOOLS) {
    let matched: string | null = null;
    for (const raw of tool.paths) {
      const abs = expandHome(raw);
      if (!existsSafe(abs)) continue;
      if (tool.grep) {
        const sub = findGrepSubdir(abs, tool.grep);
        if (sub) {
          matched = sub;
          break;
        }
      } else {
        matched = abs;
        break;
      }
    }
    if (matched) {
      found.push({
        id: tool.id,
        name: tool.name,
        kind: tool.kind,
        matchedPath: matched,
        isLocal: !!tool.isLocal,
        suggestBaseUrl: tool.suggestBaseUrl,
      });
    } else {
      missing.push({ id: tool.id, name: tool.name });
    }
  }

  res.json({
    scannedAt: new Date().toISOString(),
    found,
    missing,
  });
});

// ---- AI 管家：对话（本地优先；云端需前端先确认外发再调用）----
app.post('/api/butler/ask', async (req, res) => {
  const { source, message, history } = req.body ?? {};
  if (!message || typeof message !== 'string') {
    res.status(400).json({ ok: false, error: 'message 必填' });
    return;
  }
  if (!source || (source.type !== 'local' && source.type !== 'provider')) {
    res.status(400).json({ ok: false, error: 'source 非法' });
    return;
  }
  const prov = await resolveButlerProvider(source);
  if (prov.error) {
    res.status(400).json({ ok: false, isLocal: prov.isLocal, error: prov.error });
    return;
  }
  const reply = await askButler(
    prov,
    message,
    Array.isArray(history) ? history.slice(-8) : [],
  );
  res.status(reply.ok ? 200 : 502).json(reply);
});

// ---- SSE 实时推送 ----
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(`event: hello\ndata: {}\n\n`);

  const onUsage = (u: unknown) => {
    res.write(`event: usage\ndata: ${JSON.stringify(u)}\n\n`);
  };
  usageBus.on('usage', onUsage);

  const ping = setInterval(() => res.write(`event: ping\ndata: {}\n\n`), 25000);

  req.on('close', () => {
    clearInterval(ping);
    usageBus.off('usage', onUsage);
  });
});

// ---- 代理网关：/proxy/:providerId/<任意上游路径> ----
app.all(/^\/proxy\/([^/]+)\/(.*)$/, (req, res) => {
  // 把正则捕获映射到 params
  req.params.providerId = req.params[0];
  req.params[0] = req.params[1];
  handleProxy(req, res);
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`TokenGate 本地后端：http://127.0.0.1:${PORT}（仅本机）`);
  console.log(`代理地址示例：http://127.0.0.1:${PORT}/proxy/<providerId>/v1`);
});
