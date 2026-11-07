import { useEffect, useRef, useState } from "react";

const suggestions = ["How do I post a task?", "How do I message a helper?", "How do I find a task?"];
const MAX_HISTORY_MESSAGES = 4;
const API_BASE = window.TASKHERO_API_BASE || "/api";

export default function AiChatBot({ isHidden = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState([
    { id: 1, sender: "assistant", text: "Hi, I’m Anny, your personal assistant in TaskHero. How can I help?" },
  ]);
  const messageListRef = useRef(null);
  const nextId = useRef(2);
  const requestInProgress = useRef(false);

  useEffect(() => {
    if (isOpen && messageListRef.current) messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
  }, [isOpen, messages]);

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") setIsOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  async function sendMessage(event) {
    event.preventDefault();
    if (requestInProgress.current) return;
    const text = question.trim();
    if (!text) return;

    requestInProgress.current = true;
    setIsLoading(true);
    const userMessageId = nextId.current++;
    const assistantMessageId = nextId.current++;
    setMessages((currentMessages) => [
      ...currentMessages,
      { id: userMessageId, sender: "user", text },
      { id: assistantMessageId, sender: "assistant", text: "", pending: true },
    ]);
    setQuestion("");

    const history = messages
      .filter((message) => !message.isError && message.text)
      .slice(-MAX_HISTORY_MESSAGES)
      .map((message) => ({ role: message.sender, content: message.text.slice(-500) }));

    try {
      const response = await fetch(`${API_BASE}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.message || "I couldn’t get a reply from Anny. Please try again.");
      }

      if (!response.body || !response.headers.get("content-type")?.includes("application/x-ndjson")) {
        throw new Error("Anny returned an unexpected response. Please try again.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamEnded = false;

      function processEvent(line) {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        if (event.type === "chunk" && typeof event.text === "string") {
          setMessages((currentMessages) => currentMessages.map((message) => message.id === assistantMessageId
            ? { ...message, text: message.text + event.text, pending: false }
            : message));
        } else if (event.type === "done") {
          streamEnded = true;
        } else if (event.type === "error") {
          throw new Error(event.message || "Anny could not finish the response. Please try again.");
        }
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        lines.forEach(processEvent);
      }

      buffer += decoder.decode();
      if (buffer.trim()) processEvent(buffer);
      if (!streamEnded) throw new Error("The connection ended before Anny finished. Please try again.");
    } catch (error) {
      const text = error instanceof TypeError
        ? "I couldn’t reach Anny. Check that the backend and local Ollama are running, then try again."
        : error.message || "Anny could not finish the response. Please try again.";
      setMessages((currentMessages) => currentMessages.map((message) => message.id === assistantMessageId
        ? { ...message, text: message.text ? `${message.text}\n\n${text}` : text, pending: false, isError: true }
        : message));
    } finally {
      requestInProgress.current = false;
      setIsLoading(false);
    }
  }

  function askSuggestion(text) {
    setQuestion(text);
  }

  return (
    <aside className={`help-chat ${isHidden ? "is-obscured" : ""}`} aria-label="Anny, TaskHero personal assistant">
      {isOpen && (
        <section className="help-chat-panel" id="help-chat-panel" aria-label="Chat with Anny" aria-labelledby="help-chat-title">
          <header className="help-chat-header">
            <span className="help-chat-avatar" aria-hidden="true">A</span>
            <div className="help-chat-heading">
              <h2 id="help-chat-title">Anny</h2>
              <p>Your TaskHero personal assistant</p>
            </div>
            <button className="help-chat-close" type="button" onClick={() => setIsOpen(false)} aria-label="Close Anny" title="Close Anny">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12" /></svg>
            </button>
          </header>
          <div className="help-chat-messages" ref={messageListRef} role="log" aria-live="polite" aria-relevant="additions" aria-busy={isLoading}>
            {messages.map((message) => (
              <p className={`help-chat-message ${message.sender === "user" ? "is-user" : "is-assistant"}`} key={message.id}>
                {message.text || (message.pending ? "Thinking..." : "")}
              </p>
            ))}
          </div>
          {messages.length === 1 && (
            <div className="help-chat-suggestions" aria-label="Suggested questions">
              {suggestions.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => askSuggestion(suggestion)}>{suggestion}</button>
              ))}
            </div>
          )}
          <form className="help-chat-form" onSubmit={sendMessage}>
            <label className="sr-only" htmlFor="help-chat-input">Ask Anny about TaskHero</label>
            <input id="help-chat-input" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask Anny..." autoComplete="off" maxLength={2000} disabled={isLoading} />
            <button type="submit" disabled={!question.trim() || isLoading} aria-label="Send message" title="Send message">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
            </button>
          </form>
        </section>
      )}
      <button className="help-chat-launcher" type="button" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen} aria-controls="help-chat-panel" aria-label={isOpen ? "Close Anny" : "Chat with Anny"}>
        {isOpen ? (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8Z" /></svg>
        )}
        <span>{isOpen ? "Close chat" : "Chat with Anny"}</span>
      </button>
    </aside>
  );
}