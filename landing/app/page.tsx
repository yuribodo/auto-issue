export default function Home() {
  return (
    <main>
      {/* Hero Section */}
      <section className="hero">
        <div className="hero-grid" />
        <div className="hero-content">
          <div className="hero-badge fade-up" style={{ animationDelay: "0ms" }}>
            <span className="pulse-dot" />
            <span>Open source · Growthway Hack 2026</span>
          </div>

          <div className="fade-up" style={{ animationDelay: "100ms" }}>
            <p className="hero-label">[ AUTONOMOUS CODING AGENT ]</p>
            <h1 className="hero-title">
              GitHub Issues that
              <br />
              <span className="hero-accent">ship themselves</span>
            </h1>
          </div>

          <p className="hero-subtitle fade-up" style={{ animationDelay: "200ms" }}>
            Label an issue. An AI agent writes the code, runs the tests, and
            opens a PR.
          </p>

          <div className="hero-ctas fade-up" style={{ animationDelay: "300ms" }}>
            <a
              href="https://github.com/auto-issue/auto-issue/releases/latest"
              className="btn-primary"
            >
              Download for macOS →
            </a>
            <a
              href="https://github.com/auto-issue/auto-issue"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost"
            >
              View on GitHub
            </a>
          </div>

          <div className="hero-alt-downloads fade-up" style={{ animationDelay: "300ms" }}>
            <span className="alt-download-label">Also available for</span>
            <a
              href="https://github.com/auto-issue/auto-issue/releases/latest"
              className="alt-download-link"
            >
              Windows
            </a>
            <span className="alt-download-sep">·</span>
            <a
              href="https://github.com/auto-issue/auto-issue/releases/latest"
              className="alt-download-link"
            >
              Linux
            </a>
          </div>

          <div className="hero-terminal-placeholder fade-up" style={{ animationDelay: "400ms" }}>
            {/* Terminal component will go here in US-004 */}
            <div className="terminal-placeholder-box">
              <div className="terminal-titlebar">
                <span className="terminal-dot" style={{ background: "#ff5f57" }} />
                <span className="terminal-dot" style={{ background: "#febc2e" }} />
                <span className="terminal-dot" style={{ background: "#28c840" }} />
                <span className="terminal-label">auto-issue</span>
              </div>
              <div className="terminal-body">
                <p className="terminal-line">$ awaiting implementation...</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
