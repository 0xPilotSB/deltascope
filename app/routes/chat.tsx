import { useState, useRef, type FormEvent, useEffect, useCallback } from "react";
import {
  useLoaderData,
  redirect,
  useNavigate,
  useFetcher,
  Link,
} from "react-router";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { UIMessage } from "@ai-sdk/react";
import { MarkdownRenderer } from "~/components/markdown-renderer";
import type { Route } from "./+types/chat";
import type { ChatSessionRow } from "../../workers/chat-sessions";

/**
 * Chat route — DeltaScope AI assistant.
 *
 * Dark-themed UI consistent with the dashboard. Includes prompt preset
 * buttons for common oracle queries.
 */

// --- Prompt presets ---

const PROMPT_PRESETS = [
  { label: "BTC Price", prompt: "What's the current BTC/USD price with confidence interval?" },
  { label: "Compare BTC vs ETH", prompt: "Compare BTC and ETH prices, funding rates, and open interest on Hyperliquid" },
  { label: "Market Overview", prompt: "Give me a full market overview of all major assets — prices, funding rates, and any notable oracle discrepancies" },
  { label: "Analyze SOL", prompt: "Run a full analysis on SOL/USD — current price, TWAP, deviation, and confidence metrics" },
  { label: "Funding Rates", prompt: "Which assets have the highest and lowest funding rates on Hyperliquid right now?" },
  { label: "Search Feed", prompt: "Search for Pyth price feeds related to " },
];

// --- Helpers ---

function getSessionsStub(context: Route.LoaderArgs["context"]) {
  const { env, ownerId } = context.cloudflare;
  const binding = (env as any).CHAT_SESSIONS as DurableObjectNamespace;
  const doId = binding.idFromName(ownerId);
  return binding.get(doId);
}

// --- Loader ---

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session");
  const stub = getSessionsStub(context);

  if (!sessionId) {
    const newId = crypto.randomUUID();
    await stub.ensureSession(newId);
    url.searchParams.set("session", newId);
    throw redirect(url.pathname + url.search);
  }

  const sessions = await stub.listSessions();
  const isOwned = sessions.some((s) => s.id === sessionId);

  if (!isOwned) {
    url.searchParams.delete("session");
    throw redirect(url.pathname);
  }

  return { sessionId, sessions };
}

// --- Action ---

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");
  const stub = getSessionsStub(context);

  if (intent === "delete") {
    const id = formData.get("id") as string;
    if (id) {
      const deleted = await stub.deleteSession(id);
      if (deleted) {
        const chatBinding = (context.cloudflare.env as any).Chat as
          | DurableObjectNamespace
          | undefined;
        if (chatBinding) {
          try {
            const chatStub = chatBinding.get(chatBinding.idFromName(id));
            await (chatStub as any).deleteAllMessages();
          } catch {}
        }
      }
    }
    return { ok: true };
  }

  if (intent === "update-title") {
    const id = formData.get("id") as string;
    const title = formData.get("title") as string;
    if (id && title) await stub.updateTitle(id, title);
    return { ok: true };
  }

  return { ok: false };
}

// --- Components ---

export default function ChatPage() {
  const { sessionId, sessions } = useLoaderData<typeof loader>();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex h-screen bg-[#0a0e14]">
        <div className="w-64 bg-[#0d1117] border-r border-emerald-900/30" />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-emerald-400/60">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading DeltaScope AI...
          </div>
        </div>
      </div>
    );
  }

  return (
    <ChatWithSidebar sessionId={sessionId} initialSessions={sessions} />
  );
}

function ChatWithSidebar({
  sessionId,
  initialSessions,
}: {
  sessionId: string;
  initialSessions: ChatSessionRow[];
}) {
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const loaderData = useLoaderData<typeof loader>();
  const sessions = loaderData.sessions ?? initialSessions;

  const handleNewChat = () => navigate(`/chat`);
  const handleSelectSession = (id: string) => navigate(`/chat?session=${id}`);

  const handleDeleteSession = (id: string) => {
    fetcher.submit({ intent: "delete", id }, { method: "post" });
    if (id === sessionId) handleNewChat();
  };

  const handleTitleUpdate = useCallback(
    (title: string) => {
      fetcher.submit(
        { intent: "update-title", id: sessionId, title },
        { method: "post" }
      );
    },
    [sessionId, fetcher]
  );

  const sortedSessions = [...sessions].sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );

  return (
    <div className="flex h-screen bg-[#0a0e14]">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? "w-64" : "w-0"
        } bg-[#0d1117] border-r border-emerald-900/30 text-gray-300 flex flex-col transition-all duration-200 overflow-hidden`}
      >
        {/* Header with nav */}
        <div className="p-3 space-y-2">
          <Link
            to="/"
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8.5 2L3.5 7L8.5 12" />
            </svg>
            Dashboard
          </Link>
          <button
            onClick={handleNewChat}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-900/50 hover:bg-emerald-900/20 hover:border-emerald-700/50 transition-colors text-sm text-emerald-400"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="3" x2="8" y2="13" />
              <line x1="3" y1="8" x2="13" y2="8" />
            </svg>
            New Chat
          </button>
        </div>

        {/* Session list */}
        <nav className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
          {sortedSessions.map((session) => (
            <div
              key={session.id}
              className={`group flex items-center rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors ${
                session.id === sessionId
                  ? "bg-emerald-900/30 text-emerald-300 border border-emerald-800/40"
                  : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200 border border-transparent"
              }`}
              onClick={() => handleSelectSession(session.id)}
            >
              <span className="flex-1 truncate">{session.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteSession(session.id);
                }}
                className="opacity-0 group-hover:opacity-100 ml-2 p-0.5 hover:text-red-400 transition-opacity"
                title="Delete chat"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <line x1="3" y1="3" x2="11" y2="11" />
                  <line x1="11" y1="3" x2="3" y2="11" />
                </svg>
              </button>
            </div>
          ))}
        </nav>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        <ChatClient
          sessionId={sessionId}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onTitleUpdate={handleTitleUpdate}
        />
      </div>
    </div>
  );
}

function ChatClient({
  sessionId,
  sidebarOpen,
  onToggleSidebar,
  onTitleUpdate,
}: {
  sessionId: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onTitleUpdate: (title: string) => void;
}) {
  const [input, setInput] = useState("");
  const [titleSet, setTitleSet] = useState(false);
  const initialMessageCountRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitleSet(false);
    initialMessageCountRef.current = null;
  }, [sessionId]);

  const agent = useAgent({
    agent: "Chat",
    name: sessionId,
  });

  const { messages, sendMessage, status, error, clearHistory } = useAgentChat({
    agent,
  });

  const isLoading = status === "streaming" || status === "submitted";
  const isStreaming = status === "streaming";

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Update sidebar title from first user message
  useEffect(() => {
    if (titleSet) return;
    if (initialMessageCountRef.current === null) {
      initialMessageCountRef.current = messages.length;
      return;
    }
    if (messages.length <= initialMessageCountRef.current) return;
    const firstUserMsg = messages.find((m) => m.role === "user");
    if (firstUserMsg) {
      const text = firstUserMsg.parts
        ?.filter(
          (p: any): p is { type: "text"; text: string } => p.type === "text"
        )
        .map((p: any) => p.text)
        .join("");
      if (text) {
        onTitleUpdate(text.length > 40 ? text.slice(0, 40) + "..." : text);
        setTitleSet(true);
      }
    }
  }, [messages, titleSet, onTitleUpdate]);

  const handleSend = async (text: string) => {
    if (!text.trim() || isLoading) return;
    setInput("");
    await sendMessage({
      role: "user",
      parts: [{ type: "text", text: text.trim() }],
    });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await handleSend(input);
  };

  return (
    <>
      {/* Header */}
      <header className="bg-[#0d1117] border-b border-emerald-900/30 px-4 py-3 flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="p-1.5 rounded-lg hover:bg-emerald-900/20 text-gray-400 hover:text-emerald-400 transition-colors"
          title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="3" y1="5" x2="17" y2="5" />
            <line x1="3" y1="10" x2="17" y2="10" />
            <line x1="3" y1="15" x2="17" y2="15" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <h1 className="text-lg font-semibold text-gray-100 font-['Space_Grotesk']">
            DeltaScope AI
          </h1>
        </div>
        <span className="text-xs text-gray-500 font-mono">
          MCP Tools: 6 active
        </span>
        <div className="flex-1" />
        <Link
          to="/"
          className="text-xs text-gray-500 hover:text-emerald-400 transition-colors mr-2"
        >
          Dashboard
        </Link>
        <button
          onClick={clearHistory}
          className="text-xs text-gray-500 hover:text-red-400 transition-colors"
        >
          Clear
        </button>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-900/30 border border-emerald-800/40 mb-4">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-emerald-400">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-100 font-['Space_Grotesk'] mb-2">
                DeltaScope AI
              </h2>
              <p className="text-sm text-gray-500 max-w-md">
                Ask about real-time oracle prices, funding rates, open interest,
                historical data, and more across 1,930+ Pyth price feeds.
              </p>
            </div>

            {/* Prompt presets */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 w-full max-w-lg">
              {PROMPT_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => handleSend(preset.prompt)}
                  className="text-left px-3 py-2.5 rounded-lg border border-emerald-900/40 bg-emerald-900/10 hover:bg-emerald-900/25 hover:border-emerald-700/50 text-xs text-gray-300 hover:text-emerald-300 transition-all"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message: UIMessage, index: number) => {
          const isLastMessage = index === messages.length - 1;
          const isAssistant = message.role === "assistant";

          return (
            <div
              key={message.id}
              className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}
            >
              <div
                className={`max-w-[80%] rounded-xl px-4 py-3 ${
                  isAssistant
                    ? "bg-[#0d1117] border border-emerald-900/30 text-gray-200"
                    : "bg-emerald-700/30 border border-emerald-700/40 text-gray-100"
                }`}
              >
                {isAssistant ? (
                  <>
                    {message.parts?.map((part: any, i: number) => {
                      if (part.type === "text" && part.text) {
                        return (
                          <MarkdownRenderer
                            key={i}
                            content={part.text}
                            isStreaming={isStreaming && isLastMessage}
                          />
                        );
                      }
                      // Tool invocation indicator
                      if (part.type?.startsWith?.("tool-")) {
                        const toolName = part.type.replace("tool-", "");
                        if (part.state === "call" || part.state === "partial-call") {
                          return (
                            <div key={i} className="flex items-center gap-2 py-1 text-xs text-emerald-400/70">
                              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Calling {toolName}...
                            </div>
                          );
                        }
                        if (part.state === "output-available") {
                          return (
                            <div key={i} className="flex items-center gap-1.5 py-1 text-xs text-emerald-500/60">
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M2 6l3 3 5-5" />
                              </svg>
                              {toolName}
                            </div>
                          );
                        }
                      }
                      return null;
                    })}
                    {isLoading && isLastMessage && (
                      <div className="flex space-x-1 py-1">
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" />
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.1s]" />
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                      </div>
                    )}
                  </>
                ) : (
                  <p className="whitespace-pre-wrap text-sm">
                    {message.parts
                      ?.filter(
                        (p: any): p is { type: "text"; text: string } =>
                          p.type === "text"
                      )
                      .map((p: any) => p.text)
                      .join("")}
                  </p>
                )}
              </div>
            </div>
          );
        })}

        {isLoading &&
          messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex justify-start">
              <div className="bg-[#0d1117] border border-emerald-900/30 rounded-xl px-4 py-3">
                <div className="flex space-x-1">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" />
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.1s]" />
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                </div>
              </div>
            </div>
          )}

        {error && (
          <div className="bg-red-900/20 border border-red-800/40 rounded-xl px-4 py-3 text-red-300 text-sm">
            Error: {error.message}
          </div>
        )}

        <div ref={messagesEndRef} />
      </main>

      {/* Input */}
      <footer className="bg-[#0d1117] border-t border-emerald-900/30 p-4">
        <form onSubmit={onSubmit} className="flex gap-2 max-w-4xl mx-auto">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about prices, funding rates, TWAP, oracle data..."
            className="flex-1 rounded-xl border border-emerald-900/40 bg-[#0a0e14] px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 focus:border-emerald-700 transition-colors"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-emerald-700 text-white px-5 py-2.5 rounded-xl hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-medium"
          >
            {isLoading ? (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              "Send"
            )}
          </button>
        </form>
      </footer>
    </>
  );
}
