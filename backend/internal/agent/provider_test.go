package agent

import (
	"testing"

	"auto-issue/internal/config"
)

func TestNewProviderClaude(t *testing.T) {
	p, err := NewProvider(ProviderConfig{Type: "claude-code"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.Type() != "claude-code" {
		t.Errorf("Type() = %q, want %q", p.Type(), "claude-code")
	}
}

func TestNewProviderCodex(t *testing.T) {
	p, err := NewProvider(ProviderConfig{Type: "codex"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.Type() != "codex" {
		t.Errorf("Type() = %q, want %q", p.Type(), "codex")
	}
}

func TestNewProviderGemini(t *testing.T) {
	p, err := NewProvider(ProviderConfig{Type: "gemini"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.Type() != "gemini" {
		t.Errorf("Type() = %q, want %q", p.Type(), "gemini")
	}
}

func TestNewProviderUnknown(t *testing.T) {
	_, err := NewProvider(ProviderConfig{Type: "unknown-agent"})
	if err == nil {
		t.Fatal("expected error for unknown agent type")
	}
}

func TestNewProviderFromAgentConfig(t *testing.T) {
	cfg := config.AgentConfig{
		Type:  "codex",
		Model: "o3-mini",
	}
	p, err := NewProvider(ProviderConfig{
		Type:  cfg.Type,
		Model: cfg.Model,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.Type() != "codex" {
		t.Errorf("Type() = %q, want %q", p.Type(), "codex")
	}
}
