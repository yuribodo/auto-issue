"use client";

import { useState, useEffect, useCallback } from "react";

interface LogLine {
  text: string;
  delay: number;
  color: "muted" | "white" | "accent" | "accent-bold";
}

const LOG_SEQUENCE: LogLine[] = [
  { text: "INFO  Picked issue #87 — \"Add dark mode toggle\"", delay: 0, color: "muted" },
  { text: "INFO  Cloning repo → isolated workspace", delay: 800, color: "muted" },
  { text: "T·01  Reading issue body and comments...", delay: 1800, color: "white" },
  { text: "T·02  Planning implementation strategy", delay: 2800, color: "white" },
  { text: "T·03  Writing src/components/ThemeToggle.tsx", delay: 3800, color: "white" },
  { text: "T·04  Writing src/hooks/useTheme.ts", delay: 4600, color: "white" },
  { text: "T·05  Updating tailwind.config.ts", delay: 5400, color: "white" },
  { text: "OK    All 12 tests passing", delay: 6200, color: "accent" },
  { text: "OK    Lint clean · no type errors", delay: 7000, color: "accent" },
  { text: "DONE  PR #87 opened → ready for review", delay: 7800, color: "accent-bold" },
];

const DONE_HOLD_MS = 3000;
const RESTART_DELAY_MS = 500;

export default function Terminal() {
  const [visibleLines, setVisibleLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<"running" | "done">("running");

  const runCycle = useCallback(() => {
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    setVisibleLines([]);
    setStatus("running");

    for (let i = 0; i < LOG_SEQUENCE.length; i++) {
      const line = LOG_SEQUENCE[i];
      const t = setTimeout(() => {
        setVisibleLines((prev) => [...prev, line]);
        if (i === LOG_SEQUENCE.length - 1) {
          setStatus("done");
        }
      }, line.delay);
      timeouts.push(t);
    }

    return timeouts;
  }, []);

  useEffect(() => {
    let timeouts = runCycle();
    let restartTimeout: ReturnType<typeof setTimeout>;

    const lastDelay = LOG_SEQUENCE[LOG_SEQUENCE.length - 1].delay;

    restartTimeout = setTimeout(() => {
      const loop = () => {
        timeouts = runCycle();
        const nextLastDelay = LOG_SEQUENCE[LOG_SEQUENCE.length - 1].delay;
        restartTimeout = setTimeout(loop, nextLastDelay + DONE_HOLD_MS + RESTART_DELAY_MS);
      };
      loop();
    }, lastDelay + DONE_HOLD_MS + RESTART_DELAY_MS);

    return () => {
      timeouts.forEach(clearTimeout);
      clearTimeout(restartTimeout);
    };
  }, [runCycle]);

  const colorVar = (c: LogLine["color"]) => {
    switch (c) {
      case "muted": return "var(--text-muted)";
      case "white": return "var(--text)";
      case "accent": return "var(--accent)";
      case "accent-bold": return "var(--accent)";
    }
  };

  return (
    <div className="terminal-box">
      <div className="terminal-titlebar">
        <span className="terminal-dot" style={{ background: "#ff5f57" }} />
        <span className="terminal-dot" style={{ background: "#febc2e" }} />
        <span className="terminal-dot" style={{ background: "#28c840" }} />
        <span className="terminal-label">auto-issue</span>
      </div>
      <div className="terminal-body">
        {visibleLines.map((line, i) => (
          <p
            key={`${i}-${line.text}`}
            className="terminal-line terminal-line-enter"
            style={{
              color: colorVar(line.color),
              fontWeight: line.color === "accent-bold" ? 500 : 400,
            }}
          >
            {line.text}
          </p>
        ))}
      </div>
      <div className="terminal-statusbar">
        <span
          className={`terminal-status-dot ${status === "running" ? "terminal-status-dot-running" : "terminal-status-dot-done"}`}
        />
        <span className="terminal-status-text">
          {status === "running" ? "running" : "done · PR #87 opened"}
        </span>
      </div>
    </div>
  );
}
