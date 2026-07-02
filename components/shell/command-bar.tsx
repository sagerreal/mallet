"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

export function CommandBar() {
  const [value, setValue] = useState("");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    // Route to /assistant with the query text; full agent wiring is a follow-up.
    const params = new URLSearchParams({ q: trimmed });
    router.push(`/assistant?${params.toString()}`);
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSubmit();
  };

  return (
    <div className="cmdline" id="cmdbarWrap">
      <div className="cmd-menu" id="cmdMenu" />
      <div className="cl-bar">
        <span className="cl-promptwrap">
          <span className="cl-prompt">✦</span>
          <span className="cl-caret" aria-hidden="true" />
        </span>
        <input
          ref={inputRef}
          id="cmdbar"
          placeholder="Ask Mallet — or just say what you want done…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
}
