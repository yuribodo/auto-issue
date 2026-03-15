import IssueFlow from "./issue-flow";

export default function Home() {
  return (
    <main>
      {/* Hero Section */}
      <section className="hero">
        <div className="hero-grid" />
        <div className="hero-content">
          <div className="hero-text">
            <div className="hero-badge fade-up" style={{ animationDelay: "0ms" }}>
              <span className="pulse-dot" />
              <span>Open source · Growthway Hack 2026</span>
            </div>

            <div className="fade-up" style={{ animationDelay: "100ms" }}>
              <p className="hero-label">[ AUTONOMOUS CODING AGENT ]</p>
              <h1 className="hero-title">
                GitHub Issues that{" "}
                <span className="hero-accent">ship themselves</span>
              </h1>
            </div>

            <p className="hero-subtitle fade-up" style={{ animationDelay: "200ms" }}>
              Label an issue. An AI agent writes the code, runs the tests, and
              opens a PR.
            </p>

            <div className="hero-ctas fade-up" style={{ animationDelay: "300ms" }}>
              <a
                href="https://github.com/yuribodo/auto-issue/releases/latest"
                className="btn-primary"
              >
                Download for macOS →
              </a>
              <a
                href="https://github.com/yuribodo/auto-issue"
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
                href="https://github.com/yuribodo/auto-issue/releases/latest"
                className="alt-download-link"
              >
                Windows
              </a>
              <span className="alt-download-sep">·</span>
              <a
                href="https://github.com/yuribodo/auto-issue/releases/latest"
                className="alt-download-link"
              >
                Linux
              </a>
            </div>
          </div>

          <div className="hero-demo fade-up" style={{ animationDelay: "400ms" }}>
            <IssueFlow />
          </div>
        </div>
      </section>
      {/* How It Works */}
      <section className="how-it-works">
        <div className="how-it-works-header">
          <p className="section-label">[ HOW IT WORKS ]</p>
          <h2 className="section-title">Three steps. Zero babysitting.</h2>
        </div>
        <div className="steps-grid">
          <div className="step">
            <p className="step-number">[ 01 ]</p>
            <svg className="step-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
            <h3 className="step-title">Label the issue</h3>
            <p className="step-desc">
              Add the <code>auto-issue</code> label to any GitHub issue.
              The daemon picks it up within seconds.
            </p>
          </div>
          <div className="step">
            <p className="step-number">[ 02 ]</p>
            <svg className="step-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2z" />
            </svg>
            <h3 className="step-title">Agent takes over</h3>
            <p className="step-desc">
              The AI clones the repo into an isolated workspace, reads the issue,
              plans the implementation, and writes the code.
            </p>
          </div>
          <div className="step">
            <p className="step-number">[ 03 ]</p>
            <svg className="step-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <h3 className="step-title">Review the PR</h3>
            <p className="step-desc">
              Tests pass, lint is clean, and a PR is opened automatically.
              You just review and merge.
            </p>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="final-cta">
        <div className="final-cta-glow" />
        <div className="final-cta-content">
          <p className="section-label">[ GET STARTED ]</p>
          <h2 className="section-title">Ready to stop supervising agents?</h2>
          <p className="final-cta-subtitle">
            Connect your repository and watch the first PR open itself.
          </p>
          <div className="final-cta-buttons">
            <a
              href="https://github.com/yuribodo/auto-issue/releases/latest"
              className="btn-primary"
            >
              Download for macOS →
            </a>
            <a
              href="https://github.com/yuribodo/auto-issue"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <span className="footer-text">auto-issue · growthway hack 2026</span>
        <span className="footer-text">built with Go + Next.js</span>
      </footer>
    </main>
  );
}
