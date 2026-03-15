package models

import "time"

// Issue is the GORM model for the issues table.
type Issue struct {
	IssueID       string     `json:"id" gorm:"primaryKey;column:issue_id"`
	Title         string     `json:"title" gorm:"not null"`
	Description   string     `json:"description" gorm:"not null;default:''"`
	Phase         string     `json:"phase" gorm:"not null;default:'backlog';index"`
	Iteration     int        `json:"iteration" gorm:"not null;default:0"`
	WorkspacePath string     `json:"workspace_path" gorm:"not null;default:''"`
	RepoPath      string     `json:"repo_path" gorm:"not null;default:''"`
	StartedAt     *time.Time `json:"started_at"`
	LastFeedback  string     `json:"last_feedback,omitempty" gorm:"not null;default:''"`
	FeedbackCount int        `json:"feedback_count" gorm:"not null;default:0"`
	LastOutput    string     `json:"last_output,omitempty" gorm:"not null;default:''"`
	AgentLogs     string     `json:"agent_logs,omitempty" gorm:"not null;default:''"`
	LastRunAt     *time.Time `json:"last_run_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt     time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
}
