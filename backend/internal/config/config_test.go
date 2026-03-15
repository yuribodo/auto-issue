package config

import (
	"testing"
	"time"
)

func TestDefault(t *testing.T) {
	cfg := Default()

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

func TestValidate(t *testing.T) {
	tests := []struct {
		name    string
		modify  func(c *Config)
		wantErr bool
	}{
		{
			name:    "valid defaults",
			modify:  func(c *Config) {},
			wantErr: false,
		},
		{
			name:    "invalid port",
			modify:  func(c *Config) { c.APIPort = 99999 },
			wantErr: true,
		},
		{
			name:    "zero concurrency",
			modify:  func(c *Config) { c.MaxConcurrency = 0 },
			wantErr: true,
		},
		{
			name:    "zero max_iterations",
			modify:  func(c *Config) { c.Agent.MaxIterations = 0 },
			wantErr: true,
		},
		{
			name:    "timeout too short",
			modify:  func(c *Config) { c.Agent.Timeout.Duration = 10 * time.Second },
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := Default()
			tt.modify(cfg)
			err := cfg.validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("validate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
