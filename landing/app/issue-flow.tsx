"use client";

import { useState, useEffect, useCallback } from "react";

type Phase =
  | "open"
  | "agent"
  | "task1"
  | "task2"
  | "task3"
  | "pr"
  | "merged";

interface PhaseConfig {
  badge: string;
  badgeClass: string;
  tasks: number;
}

const PHASES: Record<Phase, PhaseConfig> = {
  open: { badge: "OPEN", badgeClass: "issue-badge-open", tasks: 0 },
  agent: { badge: "AGENT WORKING", badgeClass: "issue-badge-agent", tasks: 0 },
  task1: { badge: "AGENT WORKING", badgeClass: "issue-badge-agent", tasks: 1 },
  task2: { badge: "AGENT WORKING", badgeClass: "issue-badge-agent", tasks: 2 },
  task3: { badge: "AGENT WORKING", badgeClass: "issue-badge-agent", tasks: 3 },
  pr: { badge: "PR OPENED", badgeClass: "issue-badge-pr", tasks: 3 },
  merged: { badge: "MERGED", badgeClass: "issue-badge-merged", tasks: 3 },
};

const TASKS = [
  "Reading issue...",
  "Writing 3 files...",
  "Tests passing (12/12)",
];

const TIMELINE: { phase: Phase; delay: number }[] = [
  { phase: "open", delay: 0 },
  { phase: "agent", delay: 1500 },
  { phase: "task1", delay: 2500 },
  { phase: "task2", delay: 3500 },
  { phase: "task3", delay: 4500 },
  { phase: "pr", delay: 5500 },
  { phase: "merged", delay: 7000 },
];

const CYCLE_MS = 9000;

export default function IssueFlow() {
  const [phase, setPhase] = useState<Phase>("open");
  const [visible, setVisible] = useState(true);

  const runCycle = useCallback(() => {
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    setVisible(true);
    setPhase("open");

    for (const step of TIMELINE) {
      const t = setTimeout(() => setPhase(step.phase), step.delay);
      timeouts.push(t);
    }

    return timeouts;
  }, []);

  useEffect(() => {
    let timeouts = runCycle();
    let loopTimeout: ReturnType<typeof setTimeout>;

    const startLoop = () => {
      loopTimeout = setTimeout(() => {
        setVisible(false);
        setTimeout(() => {
          timeouts = runCycle();
          startLoop();
        }, 400);
      }, CYCLE_MS);
    };

    startLoop();

    return () => {
      timeouts.forEach(clearTimeout);
      clearTimeout(loopTimeout);
    };
  }, [runCycle]);

  const config = PHASES[phase];

  return (
    <div className={`issue-card ${visible ? "issue-card-enter" : "issue-card-exit"} ${phase === "merged" ? "issue-card-merged" : ""}`}>
      <div className="issue-header">
        <div className="issue-title-row">
          <span className="issue-number">#87</span>
          <span className="issue-title-text">Add dark mode toggle</span>
        </div>
        <span className={`issue-badge ${config.badgeClass}`} key={config.badge}>
          {config.badge}
        </span>
      </div>

      <div className="issue-body">
        {TASKS.map((task, i) => (
          <div
            key={task}
            className={`issue-task ${i < config.tasks ? "issue-task-done" : "issue-task-pending"}`}
          >
            <span className="issue-task-check">{i < config.tasks ? "✓" : " "}</span>
            <span>{task}</span>
          </div>
        ))}
      </div>

      <div className="issue-footer">
        <span className="issue-branch">branch: fix/87-dark-mode</span>
        <span className="issue-files">· 3 files</span>
      </div>
    </div>
  );
}
