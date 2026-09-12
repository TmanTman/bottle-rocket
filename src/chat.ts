/**
 * Chat panel: streams a turn from /api/chat and hands any rocket the agent builds back to the scene.
 * The Claude message history is opaque here; we render our own transcript.
 */
import type { Rocket } from "./rockets/types";
import type { ChatError, ChatEvent, ChatMessage, ChatRequest } from "./api/protocol";

export interface ChatHooks {
  /** The rocket currently shown in the scene (preset or custom). */
  getRocket: () => Rocket;
  /** Called when the agent creates or edits the custom rocket. */
  onRocket: (rocket: Rocket) => void;
}

const SUGGESTIONS = [
  "Build me a two-stage rocket that goes as high as possible",
  "Give the Dart four bigger fins and make it red",
  "How high would this go at 8 bar with 40% water?",
];

const TOOL_LABELS: Record<string, string> = {
  set_rocket: "Building the rocket…",
  simulate_rocket: "Running the simulation…",
};

/** Yields each SSE `data:` payload from a fetch response body. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) yield JSON.parse(data) as ChatEvent;
    }
  }
}

export function initChat(hooks: ChatHooks) {
  const log = document.getElementById("chatLog") as HTMLDivElement;
  const form = document.getElementById("chatForm") as HTMLFormElement;
  const input = document.getElementById("chatInput") as HTMLTextAreaElement;
  const send = document.getElementById("chatSend") as HTMLButtonElement;
  const toggle = document.getElementById("chatToggle") as HTMLButtonElement;
  const panel = document.getElementById("chat") as HTMLElement;

  let history: ChatMessage[] = [];
  let busy = false;

  const scroll = () => { log.scrollTop = log.scrollHeight; };
  const add = (kind: "user" | "bot" | "event" | "error", text: string) => {
    const el = document.createElement("div");
    el.className = `msg ${kind}`;
    el.textContent = text;
    log.appendChild(el);
    scroll();
    return el;
  };

  // Welcome + tappable suggestions
  add("bot", "Tell me what to build. I only know 2L soda bottles, tape and fins, but I know them well.");
  const tips = document.createElement("div");
  tips.className = "tips";
  for (const s of SUGGESTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = s;
    b.addEventListener("click", () => { input.value = s; input.focus(); });
    tips.appendChild(b);
  }
  log.appendChild(tips);

  async function submit() {
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    send.disabled = true;
    input.value = "";
    add("user", text);

    // The placeholder becomes the first streamed bubble; tool calls close a bubble and open a new one after.
    let bubble: HTMLDivElement | null = add("bot", "…");
    bubble.classList.add("pending");
    let bubbleHasText = false;
    let status: HTMLDivElement | null = null;
    let anyText = false;
    let gotRocket = false;

    const write = (delta: string) => {
      if (!bubble) { bubble = add("bot", ""); bubbleHasText = false; }
      if (!bubbleHasText) { bubble.classList.remove("pending"); bubble.textContent = ""; bubbleHasText = true; }
      bubble.textContent += delta;
      anyText = true;
      scroll();
    };
    const closeBubble = () => {
      if (bubble && !bubbleHasText) bubble.remove();
      bubble = null;
    };

    const body: ChatRequest = { message: text, messages: history, rocket: hooks.getRocket() };
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(body),
      });
      const isStream = res.headers.get("content-type")?.includes("text/event-stream");
      if (!res.ok || !isStream || !res.body) {
        closeBubble();
        const data = (await res.json().catch(() => null)) as ChatError | null;
        add("error", data?.error ?? `Request failed (${res.status})`);
        return;
      }

      for await (const ev of readEvents(res.body)) {
        switch (ev.type) {
          case "text":
            write(ev.delta);
            break;
          case "tool":
            if (ev.status === "start") {
              closeBubble();
              status = add("event", TOOL_LABELS[ev.name] ?? "Working…");
              status.classList.add("pending");
            } else if (status) {
              status.classList.remove("pending");
              if (ev.status === "error") status.textContent = "Design rejected by the validator, fixing it…";
              else if (ev.name === "simulate_rocket") status.textContent = "Simulation done";
            }
            break;
          case "rocket":
            gotRocket = true;
            hooks.onRocket(ev.rocket);
            if (status) status.textContent = `Loaded “${ev.rocket.name}” onto the pad`;
            break;
          case "done":
            history = ev.response.messages;
            break;
          case "error":
            closeBubble();
            add("error", ev.error);
            break;
        }
      }
      closeBubble();
      if (!anyText && gotRocket) add("bot", "Done.");
    } catch (err) {
      closeBubble();
      add("error", err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
      send.disabled = false;
      input.focus();
    }
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); }
  });
  toggle.addEventListener("click", () => {
    panel.classList.toggle("collapsed");
    toggle.textContent = panel.classList.contains("collapsed") ? "+" : "–";
  });
}
