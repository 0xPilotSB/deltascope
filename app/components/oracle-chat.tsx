"use client";

import { useState, useEffect, useCallback, useRef, Suspense, lazy } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { UIMessage } from "@ai-sdk/react";
import { MarkdownRenderer } from "~/components/markdown-renderer";

const PROMPT_PRESETS = [
  { label: "BTC Price", prompt: "What's the current BTC/USD price with confidence interval?" },
  { label: "Compare BTC vs ETH", prompt: "Compare BTC and ETH prices, funding rates, and open interest on Hyperliquid" },
  { label: "Market Overview", prompt: "Give me a full market overview of all major assets" },
  { label: "Analyze SOL", prompt: "Run a full analysis on SOL/USD" },
  { label: "Funding Rates", prompt: "Which assets have the highest and lowest funding rates right now?" },
  { label: "Search Feed", prompt: "Search for Pyth price feeds related to " },
];

function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = sessionStorage.getItem("oracle-chat-session");
  if (!id) {
    id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    sessionStorage.setItem("oracle-chat-session", id);
  }
  return id;
}

/** Retry-aware initial message fetcher — retries once on 5xx */
async function fetchInitialMessagesWithRetry({ agent, name, url }: { agent?: string; name?: string; url: string }) {
  const getMessagesUrl = new URL(url);
  getMessagesUrl.pathname += "/get-messages";

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(getMessagesUrl.toString());
      if (response.ok) {
        const text = await response.text();
        if (!text) return [];
        return JSON.parse(text);
      }
      // Retry on 5xx (includes 525 SSL handshake failure)
      if (response.status >= 500 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      return [];
    } catch {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      return [];
    }
  }
  return [];
}

/**
 * Inner chat panel — only mounts when user opens the chat.
 * This avoids agent connection + get-messages fetch on every page load.
 */
function ChatPanel({ onClose }: { onClose: () => void }) {
  const [inputValue, setInputValue] = useState("");
  const [sessionId] = useState(getSessionId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const agent = useAgent({ agent: "Chat", name: sessionId });
  const { messages, sendMessage, status, error, clearHistory } = useAgentChat({
    agent,
    getInitialMessages: fetchInitialMessagesWithRetry,
  });

  const isLoading = status === "streaming" || status === "submitted";

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendMessage({ role: "user", parts: [{ type: "text", text: trimmed }] });
    setInputValue("");
  }, [sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(inputValue);
    }
  }, [handleSend, inputValue]);

  const handlePreset = useCallback((prompt: string) => {
    handleSend(prompt);
  }, [handleSend]);

  return (
    <div
      className="fixed bottom-0 right-0 sm:bottom-6 sm:right-6 z-[60] w-full sm:w-[400px] h-[30vh] sm:h-[600px] sm:max-h-[80vh] rounded-t-xl sm:rounded-xl border border-white/10 bg-[#0a0e14] shadow-2xl shadow-black/60 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#0c1018]">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-emerald-500/20 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-white" style={{ fontFamily: "'Space Grotesk Variable', sans-serif" }}>
            DeltaScope AI
          </span>
          {isLoading && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          )}
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={clearHistory}
              className="p-1.5 rounded-md hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
              title="Clear history"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
                <path d="M4 24L12 8L18 18L28 4" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-sm text-white/40 text-center">
              Ask about prices, funding rates, or market analysis
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-[320px]">
              {PROMPT_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => handlePreset(preset.prompt)}
                  className="text-left px-3 py-2 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-xs text-white/60 hover:text-white/80 transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg: UIMessage) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-emerald-600/20 text-white border border-emerald-500/20"
                      : "bg-white/[0.04] text-white/90 border border-white/5"
                  }`}
                >
                  {msg.parts?.map((part, i) => {
                    if (part.type === "text") {
                      return msg.role === "assistant" ? (
                        <MarkdownRenderer key={i} content={part.text} />
                      ) : (
                        <span key={i}>{part.text}</span>
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            ))}
            {isLoading && messages[messages.length - 1]?.role === "user" && (
              <div className="flex justify-start">
                <div className="bg-white/[0.04] border border-white/5 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 text-xs text-red-400 bg-red-950/30 border-t border-red-500/20">
          {error.message ?? "An error occurred"}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-white/10 px-3 py-3">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about prices, markets..."
            disabled={isLoading}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 disabled:opacity-50"
          />
          <button
            onClick={() => handleSend(inputValue)}
            disabled={isLoading || !inputValue.trim()}
            className="p-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:hover:bg-emerald-600 text-white transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Outer wrapper — renders only the FAB button until user clicks it.
 * Agent connection + get-messages fetch only happen when chat opens.
 */
export function OracleChatPopup() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-[60] w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/40 flex items-center justify-center transition-all hover:scale-105"
          aria-label="Open DeltaScope AI Chat"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </button>
      )}

      {isOpen && <ChatPanel onClose={() => setIsOpen(false)} />}
    </>
  );
}
