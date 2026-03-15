package agent

import (
	"testing"

	"auto-issue/internal/config"
)

func TestCodexProviderType(t *testing.T) {
	p := newCodexProvider(ProviderConfig{Type: "codex"})
	if p.Type() != "codex" {
		t.Errorf("Type() = %q, want %q", p.Type(), "codex")
	}
}

func TestCodexBuildArgs(t *testing.T) {
	tests := []struct {
		name      string
		model     string
		wantFlags []string
	}{
		{
			name:      "without model",
			model:     "",
			wantFlags: []string{"--full-auto", "--quiet"},
		},
		{
			name:      "with model",
			model:     "o3-mini",
			wantFlags: []string{"--full-auto", "--quiet", "--model", "o3-mini"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := newCodexProvider(ProviderConfig{
				Type:    "codex",
				Model:   tt.model,
				Timeout: config.Duration{},
			})

			// We can't call RunStreaming without a real binary, but we can verify
			// the provider is constructed correctly
			if p.cfg.Model != tt.model {
				t.Errorf("model = %q, want %q", p.cfg.Model, tt.model)
			}
		})
	}
}

func TestCodexProviderEnv(t *testing.T) {
	p := newCodexProvider(ProviderConfig{
		Type:    "codex",
		GHToken: "gh-token-123",
		APIKeys: map[string]string{
			"openai": "sk-test-key",
		},
	})

	if p.cfg.APIKeys["openai"] != "sk-test-key" {
		t.Error("expected OpenAI API key to be set")
	}
	if p.cfg.GHToken != "gh-token-123" {
		t.Error("expected GH token to be set")
	}
}
