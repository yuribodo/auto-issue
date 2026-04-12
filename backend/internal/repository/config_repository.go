package repository

import (
	"context"
	"fmt"
	"time"

	"auto-issue/internal/config"
	"auto-issue/internal/models"

	"gorm.io/gorm"
)

type ConfigRepository interface {
	Load(ctx context.Context) (*config.Config, error)
	Save(ctx context.Context, cfg *config.Config) error
}

type PGConfigRepository struct {
	db *gorm.DB
}

func NewPGConfigRepository(db *gorm.DB) *PGConfigRepository {
	return &PGConfigRepository{db: db}
}

var _ ConfigRepository = (*PGConfigRepository)(nil)

func (r *PGConfigRepository) Load(ctx context.Context) (*config.Config, error) {
	var row models.Config
	if err := r.db.WithContext(ctx).First(&row, 1).Error; err != nil {
		return nil, fmt.Errorf("loading config from database: %w", err)
	}

	timeout, err := time.ParseDuration(row.AgentTimeout)
	if err != nil {
		return nil, fmt.Errorf("invalid agent_timeout %q: %w", row.AgentTimeout, err)
	}

	cfg := &config.Config{
		APIPort:        row.APIPort,
		MaxConcurrency: row.MaxConcurrency,
		Agent: config.AgentConfig{
			Type:          row.AgentType,
			Model:         row.AgentModel,
			Timeout:       config.Duration{Duration: timeout},
			MaxIterations: row.AgentMaxIter,
			Prompt:        row.AgentPrompt,
			APIKeys:       make(map[string]string),
		},
		Workspace: config.WorkspaceConfig{
			BasePath: row.WorkspaceBase,
		},
	}

	if row.OpenAIAPIKey != "" {
		cfg.Agent.APIKeys["openai"] = row.OpenAIAPIKey
	}
	if row.GeminiAPIKey != "" {
		cfg.Agent.APIKeys["gemini"] = row.GeminiAPIKey
	}

	return cfg, nil
}

func (r *PGConfigRepository) Save(ctx context.Context, cfg *config.Config) error {
	row := models.Config{
		ID:             1,
		APIPort:        cfg.APIPort,
		MaxConcurrency: cfg.MaxConcurrency,
		AgentType:      cfg.Agent.Type,
		AgentModel:     cfg.Agent.Model,
		AgentTimeout:   cfg.Agent.Timeout.Duration.String(),
		AgentMaxIter:   cfg.Agent.MaxIterations,
		AgentPrompt:    cfg.Agent.Prompt,
		WorkspaceBase:  cfg.Workspace.BasePath,
	}

	if cfg.Agent.APIKeys != nil {
		row.OpenAIAPIKey = cfg.Agent.APIKeys["openai"]
		row.GeminiAPIKey = cfg.Agent.APIKeys["gemini"]
	}

	return r.db.WithContext(ctx).Save(&row).Error
}
