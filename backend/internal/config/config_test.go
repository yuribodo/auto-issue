package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadFullConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")

	data := `{
		"api_port": 9090,
		"max_concurrency": 3,
		"agent": {
			"type": "claude-code",
			"model": "claude-sonnet-4-6",
			"timeout": "15m",
			"max_iterations": 2,
			"prompt": "Fix the bug."
		},
		"workspace": {
			"base_path": "/tmp/workspaces"
		}
	}`
	os.WriteFile(path, []byte(data), 0644)

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.APIPort != 9090 {
		t.Errorf("APIPort = %d, want 9090", cfg.APIPort)
	}
	if cfg.MaxConcurrency != 3 {
		t.Errorf("MaxConcurrency = %d, want 3", cfg.MaxConcurrency)
	}
	if cfg.Agent.Type != "claude-code" {
		t.Errorf("Agent.Type = %q, want %q", cfg.Agent.Type, "claude-code")
	}
	if cfg.Agent.Model != "claude-sonnet-4-6" {
		t.Errorf("Agent.Model = %q, want %q", cfg.Agent.Model, "claude-sonnet-4-6")
	}
	if cfg.Agent.Timeout.Duration != 15*time.Minute {
		t.Errorf("Agent.Timeout = %v, want 15m", cfg.Agent.Timeout.Duration)
	}
	if cfg.Agent.MaxIterations != 2 {
		t.Errorf("Agent.MaxIterations = %d, want 2", cfg.Agent.MaxIterations)
	}
	if cfg.Agent.Prompt != "Fix the bug." {
		t.Errorf("Agent.Prompt = %q, want %q", cfg.Agent.Prompt, "Fix the bug.")
	}
	if cfg.Workspace.BasePath != "/tmp/workspaces" {
		t.Errorf("Workspace.BasePath = %q, want %q", cfg.Workspace.BasePath, "/tmp/workspaces")
	}
}

func TestLoadDefaults(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	os.WriteFile(path, []byte(`{}`), 0644)

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.APIPort != 8080 {
		t.Errorf("default APIPort = %d, want 8080", cfg.APIPort)
	}
	if cfg.MaxConcurrency != 10 {
		t.Errorf("default MaxConcurrency = %d, want 10", cfg.MaxConcurrency)
	}
	if cfg.Agent.Type != "claude-code" {
		t.Errorf("default Agent.Type = %q, want %q", cfg.Agent.Type, "claude-code")
	}
	if cfg.Agent.Model != "claude-opus-4-6" {
		t.Errorf("default Agent.Model = %q, want %q", cfg.Agent.Model, "claude-opus-4-6")
	}
	if cfg.Agent.Timeout.Duration != 30*time.Minute {
		t.Errorf("default Agent.Timeout = %v, want 30m", cfg.Agent.Timeout.Duration)
	}
	if cfg.Agent.MaxIterations != 3 {
		t.Errorf("default Agent.MaxIterations = %d, want 3", cfg.Agent.MaxIterations)
	}
}

func TestLoadInvalidPort(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	os.WriteFile(path, []byte(`{"api_port": 99999}`), 0644)

	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error for invalid port")
	}
}

func TestLoadInvalidDuration(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	os.WriteFile(path, []byte(`{"agent": {"timeout": "bad"}}`), 0644)

	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error for invalid duration")
	}
}

func TestLoadMissingFile(t *testing.T) {
	_, err := Load("/nonexistent/config.json")
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestDefaultConfigPath(t *testing.T) {
	t.Setenv("CONFIG_PATH", "/custom/path.json")
	if p := DefaultConfigPath(); p != "/custom/path.json" {
		t.Errorf("DefaultConfigPath() = %q, want /custom/path.json", p)
	}

	t.Setenv("CONFIG_PATH", "")
	home, _ := os.UserHomeDir()
	want := filepath.Join(home, ".auto-issue", "config.json")
	if p := DefaultConfigPath(); p != want {
		t.Errorf("DefaultConfigPath() = %q, want %q", p, want)
	}
}
