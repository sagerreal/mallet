/**
 * components/shell/command-bar.tsx
 * The Counter. The manila strip is the app-wide AI surface: type a sentence and
 * the record materializes in the in-flow menu above the bar (never a redirect,
 * never a floating panel). Cmd+K focuses it from anywhere; Escape folds it away.
 */

"use client";

import { useEffect, useRef } from "react";
import { useCounter } from "@/features/counter/use-counter";
import { CounterPanel } from "@/features/counter/counter-panel";

export function CommandBar() {
  const api = useCounter();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Click outside the strip folds the menu (prototype behavior).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!api.open) return;
      const target = e.target as HTMLElement | null;
      // Route through close() so the transcript always resets on panel collapse.
      if (target && !target.closest("#cmdbarWrap")) api.close();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [api]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      api.submit();
    } else if (e.key === "Tab" && api.rows.length > 0) {
      e.preventDefault();
      api.tabComplete();
    } else if (e.key === "Escape") {
      api.close();
    }
  };

  return (
    <div className={`cmdline${api.open ? " show" : ""}`} id="cmdbarWrap" ref={wrapRef}>
      <div className="cmd-menu" id="cmdMenu">
        <CounterPanel api={api} />
      </div>
      <div className="cl-bar">
        <span className="cl-promptwrap">
          <span className={`cl-prompt${api.isThinking ? " cl-thinking" : ""}`}>✦</span>
          <span className="cl-caret" aria-hidden="true" />
        </span>
        <input
          ref={api.inputRef}
          id="cmdbar"
          placeholder={api.isThinking ? "Artie is thinking…" : "Ask Artie — or just say what you want done…"}
          aria-label="Ask Artie"
          aria-busy={api.isThinking}
          // Enter submits (handleKeyDown), so the keyboard action key says "send", not "return".
          enterKeyHint="send"
          value={api.value}
          onChange={(e) => api.setValue(e.target.value)}
          onFocus={() => api.openPanel()}
          onKeyDown={handleKeyDown}
          disabled={api.isThinking}
        />
      </div>
    </div>
  );
}
