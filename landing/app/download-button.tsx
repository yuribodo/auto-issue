"use client";

import { useEffect, useState } from "react";

type OS = "macOS" | "Windows" | "Linux";

const RELEASE_BASE =
  "https://github.com/yuribodo/auto-issue/releases/latest/download";

const DOWNLOAD_MAP: Record<OS, { file: string; label: string }> = {
  macOS: { file: "Auto-Issue-0.3.1-arm64.dmg", label: "Download for macOS" },
  Windows: { file: "Auto-Issue-Setup-0.3.1.exe", label: "Download for Windows" },
  Linux: { file: "Auto-Issue-0.3.1.AppImage", label: "Download for Linux" },
};

const OS_ORDER: OS[] = ["macOS", "Windows", "Linux"];

function detectOS(): OS {
  if (typeof navigator === "undefined") return "macOS";
  const ua = navigator.userAgent;
  if (ua.includes("Win")) return "Windows";
  if (ua.includes("Linux")) return "Linux";
  return "macOS";
}

export function DownloadButton({ className }: { className: string }) {
  const [os, setOs] = useState<OS>("macOS");

  useEffect(() => {
    setOs(detectOS());
  }, []);

  const { file, label } = DOWNLOAD_MAP[os];

  return (
    <a href={`${RELEASE_BASE}/${file}`} className={className}>
      {label} →
    </a>
  );
}

export function AltDownloads() {
  const [os, setOs] = useState<OS>("macOS");

  useEffect(() => {
    setOs(detectOS());
  }, []);

  const others = OS_ORDER.filter((o) => o !== os);

  return (
    <>
      <span className="alt-download-label">Also available for</span>
      {others.map((o, i) => (
        <span key={o}>
          {i > 0 && <span className="alt-download-sep">·</span>}
          <a
            href={`${RELEASE_BASE}/${DOWNLOAD_MAP[o].file}`}
            className="alt-download-link"
          >
            {o}
          </a>
        </span>
      ))}
    </>
  );
}
