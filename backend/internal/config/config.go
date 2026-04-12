package config

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"os"
	"time"
)

type Config struct {
	APIPort        int             `json:"api_port"`
	MaxConcurrency int             `json:"max_concurrency"`
	Agent          AgentConfig     `json:"agent"`
	Workspace      WorkspaceConfig `json:"workspace"`
}

type AgentConfig struct {
	Type          string            `json:"type"`
	Model         string            `json:"model"`
	Timeout       Duration          `json:"timeout"`
	MaxIterations int               `json:"max_iterations"`
	Prompt        string            `json:"prompt"`
	APIKeys       map[string]string `json:"api_keys,omitempty"`
}

type WorkspaceConfig struct {
	BasePath string `json:"base_path"`
}

// Duration wraps time.Duration for JSON marshalling as string (e.g. "20m").
type Duration struct {
	time.Duration
}

func (d *Duration) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	dur, err := time.ParseDuration(s)
	if err != nil {
		return fmt.Errorf("invalid duration %q: %w", s, err)
	}
	d.Duration = dur
	return nil
}

func (d Duration) MarshalJSON() ([]byte, error) {
	return json.Marshal(d.Duration.String())
}

func Default() *Config {
	cfg := &Config{}
	cfg.applyDefaults()
	return cfg
}

func (c *Config) applyDefaults() {
	if c.APIPort == 0 {
		c.APIPort = 8080
	}
	if c.MaxConcurrency == 0 {
		c.MaxConcurrency = 10
	}
	if c.Agent.Type == "" {
		c.Agent.Type = "claude-code"
	}
	if c.Agent.Model == "" {
		c.Agent.Model = "claude-opus-4-6"
	}
	if c.Agent.Timeout.Duration == 0 {
		c.Agent.Timeout.Duration = 30 * time.Minute
	}
	if c.Agent.MaxIterations == 0 {
		c.Agent.MaxIterations = 3
	}
	if c.Agent.APIKeys == nil {
		c.Agent.APIKeys = make(map[string]string)
	}
	// Read API keys from environment as fallback
	if c.Agent.APIKeys["openai"] == "" {
		if key := os.Getenv("OPENAI_API_KEY"); key != "" {
			c.Agent.APIKeys["openai"] = key
		}
	}
	if c.Agent.APIKeys["gemini"] == "" {
		if key := os.Getenv("GOOGLE_API_KEY"); key != "" {
			c.Agent.APIKeys["gemini"] = key
		}
	}
	if c.Workspace.BasePath == "" {
		home, _ := os.UserHomeDir()
		c.Workspace.BasePath = filepath.Join(home, ".auto-issue", "workspaces")
	}
}

func (c *Config) validate() error {
	if c.APIPort < 1 || c.APIPort > 65535 {
		return fmt.Errorf("api_port must be between 1 and 65535, got %d", c.APIPort)
	}
	if c.MaxConcurrency < 1 {
		return fmt.Errorf("max_concurrency must be at least 1, got %d", c.MaxConcurrency)
	}
	if c.Agent.MaxIterations < 1 {
		return fmt.Errorf("agent.max_iterations must be at least 1, got %d", c.Agent.MaxIterations)
	}
	if c.Agent.Timeout.Duration < time.Minute {
		return fmt.Errorf("agent.timeout must be at least 1m, got %s", c.Agent.Timeout.Duration)
	}
	return nil
}
