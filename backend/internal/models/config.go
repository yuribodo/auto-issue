package models

import "time"

type Config struct {
	ID             int       `json:"-" gorm:"primaryKey;autoIncrement:false;default:1;check:chk_configs_id,id = 1"`
	APIPort        int       `json:"api_port" gorm:"not null;default:8080"`
	MaxConcurrency int       `json:"max_concurrency" gorm:"not null;default:10"`
	AgentType      string    `json:"agent_type" gorm:"not null;default:'claude-code'"`
	AgentModel     string    `json:"agent_model" gorm:"not null;default:'claude-opus-4-6'"`
	AgentTimeout   string    `json:"agent_timeout" gorm:"not null;default:'30m'"`
	AgentMaxIter   int       `json:"agent_max_iter" gorm:"not null;default:3"`
	AgentPrompt    string    `json:"agent_prompt" gorm:"not null;default:'Solve this issue step by step. Write clean, testable code.'"`
	WorkspaceBase  string    `json:"workspace_base" gorm:"not null;default:''"`
	OpenAIAPIKey   string    `json:"-" gorm:"not null;default:''"`
	GeminiAPIKey   string    `json:"-" gorm:"not null;default:''"`
	UpdatedAt      time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}
