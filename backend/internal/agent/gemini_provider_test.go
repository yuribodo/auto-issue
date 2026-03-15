package agent

import (
	"testing"
)

func TestGeminiProviderType(t *testing.T) {
	p := newGeminiProvider(ProviderConfig{Type: "gemini"})
	if p.Type() != "gemini" {
		t.Errorf("Type() = %q, want %q", p.Type(), "gemini")
	}
}

func TestGeminiProviderEnv(t *testing.T) {
	p := newGeminiProvider(ProviderConfig{
		Type:    "gemini",
		GHToken: "gh-token-456",
		APIKeys: map[string]string{
			"gemini": "google-api-key",
		},
	})

	if p.cfg.APIKeys["gemini"] != "google-api-key" {
		t.Error("expected Gemini API key to be set")
	}
	if p.cfg.GHToken != "gh-token-456" {
		t.Error("expected GH token to be set")
	}
}
