import { useCallback, useEffect, useRef, useState } from 'react';

export interface LocalProbe {
  url: string;
  label: string;
  online: boolean;
  models: string[];
}

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  isLocal?: boolean;
  model?: string;
  error?: boolean;
}

export type ButlerSource =
  | { type: 'local'; url: string; model?: string }
  | { type: 'provider'; providerId: string; model?: string };

/** 管家：探测本地模型 + 对话。本地优先，云端需调用方先确认外发。 */
export function useButler() {
  const [probes, setProbes] = useState<LocalProbe[]>([]);
  const [probing, setProbing] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [thinking, setThinking] = useState(false);
  const histRef = useRef<ChatMsg[]>([]);

  const probe = useCallback(async () => {
    setProbing(true);
    try {
      const r = await fetch('/api/butler/probe');
      const d = (await r.json()) as { probes: LocalProbe[] };
      setProbes(d.probes ?? []);
      return d.probes ?? [];
    } catch {
      setProbes([]);
      return [];
    } finally {
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    probe();
  }, [probe]);

  const ask = useCallback(async (source: ButlerSource, message: string) => {
    const userMsg: ChatMsg = { role: 'user', content: message };
    setMessages((prev) => [...prev, userMsg]);
    histRef.current = [...histRef.current, userMsg];
    setThinking(true);
    try {
      const r = await fetch('/api/butler/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          message,
          history: histRef.current
            .slice(0, -1)
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const d = (await r.json()) as {
        ok: boolean;
        content?: string;
        isLocal?: boolean;
        model?: string;
        error?: string;
      };
      const reply: ChatMsg = d.ok
        ? { role: 'assistant', content: d.content ?? '', isLocal: d.isLocal, model: d.model }
        : { role: 'assistant', content: d.error ?? '调用失败', error: true, isLocal: d.isLocal };
      setMessages((prev) => [...prev, reply]);
      if (d.ok) histRef.current = [...histRef.current, reply];
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `请求失败：${(e as Error).message}`, error: true },
      ]);
    } finally {
      setThinking(false);
    }
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    histRef.current = [];
  }, []);

  /** 在对话区追加一条系统/管家消息（不调 LLM，省 token） */
  const pushSystem = useCallback((content: string) => {
    const msg: ChatMsg = { role: 'assistant', content };
    setMessages((prev) => [...prev, msg]);
  }, []);

  const localOnline = probes.find((p) => p.online) ?? null;

  return { probes, probing, probe, messages, thinking, ask, clear, pushSystem, localOnline };
}
