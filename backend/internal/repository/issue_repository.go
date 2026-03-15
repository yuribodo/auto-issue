// Package repository provides data access implementations backed by PostgreSQL.
package repository

import (
	"context"
	"fmt"
	"time"

	"auto-issue/internal/constants"
	"auto-issue/internal/models"

	"gorm.io/gorm"
)

// IssueRepository defines the data access contract for issues.
type IssueRepository interface {
	Create(ctx context.Context, id, title, description, repoPath string) (*models.Issue, error)
	CreateWithGithub(ctx context.Context, id, title, description, repoPath, githubRepo string, issueNumber int) (*models.Issue, error)
	Get(ctx context.Context, id string) (*models.Issue, error)
	List(ctx context.Context, phaseFilter string) ([]*models.Issue, error)
	Transition(ctx context.Context, id string, to string) error
	SetFeedback(ctx context.Context, id string, feedback string, maxIterations int) error
	StartDeveloping(ctx context.Context, id string, workspacePath string) error
	UpdateOutput(ctx context.Context, id string, output string, logs string) error
	UpdatePR(ctx context.Context, id string, prURL string) error
	UpdateCost(ctx context.Context, id string, costUSD float64, turns int) error
}

// PGIssueRepository implements IssueRepository backed by PostgreSQL via GORM.
type PGIssueRepository struct {
	db *gorm.DB
}

// NewPGIssueRepository creates a new PostgreSQL-backed issue repository.
func NewPGIssueRepository(db *gorm.DB) *PGIssueRepository {
	return &PGIssueRepository{db: db}
}

// Compile-time interface verification.
var _ IssueRepository = (*PGIssueRepository)(nil)

func (r *PGIssueRepository) Create(ctx context.Context, id, title, description, repoPath string) (*models.Issue, error) {
	issue := models.Issue{
		IssueID:     id,
		Title:       title,
		Description: description,
		RepoPath:    repoPath,
		Phase:       constants.PhaseBacklog,
	}

	if err := r.db.WithContext(ctx).Create(&issue).Error; err != nil {
		return nil, fmt.Errorf("creating issue: %w", err)
	}

	return &issue, nil
}

func (r *PGIssueRepository) CreateWithGithub(ctx context.Context, id, title, description, repoPath, githubRepo string, issueNumber int) (*models.Issue, error) {
	issue := models.Issue{
		IssueID:     id,
		Title:       title,
		Description: description,
		RepoPath:    repoPath,
		GithubRepo:  githubRepo,
		IssueNumber: issueNumber,
		Phase:       constants.PhaseBacklog,
	}

	if err := r.db.WithContext(ctx).Create(&issue).Error; err != nil {
		return nil, fmt.Errorf("creating issue: %w", err)
	}

	return &issue, nil
}

func (r *PGIssueRepository) Get(ctx context.Context, id string) (*models.Issue, error) {
	var issue models.Issue
	if err := r.db.WithContext(ctx).Where("issue_id = ?", id).First(&issue).Error; err != nil {
		return nil, fmt.Errorf("issue %q not found", id)
	}
	return &issue, nil
}

func (r *PGIssueRepository) List(ctx context.Context, phaseFilter string) ([]*models.Issue, error) {
	var issues []*models.Issue

	query := r.db.WithContext(ctx)
	if phaseFilter != "" {
		query = query.Where("phase = ?", phaseFilter)
	}

	if err := query.Find(&issues).Error; err != nil {
		return nil, fmt.Errorf("listing issues: %w", err)
	}

	return issues, nil
}

func (r *PGIssueRepository) Transition(ctx context.Context, id string, to string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var issue models.Issue
		if err := tx.Set("gorm:query_option", "FOR UPDATE").
			Where("issue_id = ?", id).First(&issue).Error; err != nil {
			return fmt.Errorf("issue %q not found", id)
		}

		if !constants.IsValidTransition(issue.Phase, to) {
			return fmt.Errorf("invalid transition: %s → %s", issue.Phase, to)
		}

		return tx.Model(&issue).Update("phase", to).Error
	})
}

func (r *PGIssueRepository) SetFeedback(ctx context.Context, id string, feedback string, maxIterations int) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var issue models.Issue
		if err := tx.Set("gorm:query_option", "FOR UPDATE").
			Where("issue_id = ?", id).First(&issue).Error; err != nil {
			return fmt.Errorf("issue %q not found", id)
		}

		if issue.Phase != constants.PhaseHumanReview {
			return fmt.Errorf("feedback only valid in human_review phase, current: %s", issue.Phase)
		}

		issue.FeedbackCount++
		issue.LastFeedback = feedback

		if issue.FeedbackCount >= maxIterations {
			issue.Phase = constants.PhaseFailed
		} else {
			issue.Iteration++
			issue.Phase = constants.PhaseDeveloping
		}

		return tx.Save(&issue).Error
	})
}

func (r *PGIssueRepository) StartDeveloping(ctx context.Context, id string, workspacePath string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var issue models.Issue
		if err := tx.Set("gorm:query_option", "FOR UPDATE").
			Where("issue_id = ?", id).First(&issue).Error; err != nil {
			return fmt.Errorf("issue %q not found", id)
		}

		if issue.Phase != constants.PhaseDeveloping {
			return fmt.Errorf("issue must be in developing phase, current: %s", issue.Phase)
		}

		now := time.Now()
		if issue.Iteration == 0 {
			issue.Iteration = 1
			issue.StartedAt = &now
		}
		issue.WorkspacePath = workspacePath
		issue.LastRunAt = &now

		return tx.Save(&issue).Error
	})
}

func (r *PGIssueRepository) UpdateOutput(ctx context.Context, id string, output string, logs string) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&models.Issue{}).
		Where("issue_id = ?", id).
		Updates(map[string]any{
			"last_output": output,
			"agent_logs":  logs,
			"last_run_at": &now,
		}).Error
}

func (r *PGIssueRepository) UpdatePR(ctx context.Context, id string, prURL string) error {
	return r.db.WithContext(ctx).Model(&models.Issue{}).
		Where("issue_id = ?", id).
		Update("pr_url", prURL).Error
}

func (r *PGIssueRepository) UpdateCost(ctx context.Context, id string, costUSD float64, turns int) error {
	return r.db.WithContext(ctx).Model(&models.Issue{}).
		Where("issue_id = ?", id).
		Updates(map[string]any{
			"cost_usd": costUSD,
			"turns":    turns,
		}).Error
}
