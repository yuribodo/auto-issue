package repository

import (
	"context"
	"fmt"
	"sync"
	"time"

	"auto-issue/internal/constants"
	"auto-issue/internal/models"
)

// MemoryIssueRepository is an in-memory IssueRepository used for testing.
type MemoryIssueRepository struct {
	mu     sync.RWMutex
	issues map[string]*models.Issue
}

// NewMemoryIssueRepository creates a new in-memory issue repository.
func NewMemoryIssueRepository() *MemoryIssueRepository {
	return &MemoryIssueRepository{
		issues: make(map[string]*models.Issue),
	}
}

// Compile-time interface verification.
var _ IssueRepository = (*MemoryIssueRepository)(nil)

func (r *MemoryIssueRepository) Create(_ context.Context, id, title, description, repoPath, githubUser string) (*models.Issue, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.issues[id]; exists {
		return nil, fmt.Errorf("issue %q already exists", id)
	}

	issue := &models.Issue{
		IssueID:     id,
		GithubUser:  githubUser,
		Title:       title,
		Description: description,
		Phase:       constants.PhaseBacklog,
		RepoPath:    repoPath,
	}
	r.issues[id] = issue
	return copyIssue(issue), nil
}

func (r *MemoryIssueRepository) Get(_ context.Context, id string) (*models.Issue, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	issue, ok := r.issues[id]
	if !ok {
		return nil, fmt.Errorf("issue %q not found", id)
	}
	return copyIssue(issue), nil
}

func (r *MemoryIssueRepository) List(_ context.Context, phaseFilter, githubUser string) ([]*models.Issue, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var result []*models.Issue
	for _, issue := range r.issues {
		if phaseFilter != "" && issue.Phase != phaseFilter {
			continue
		}
		if githubUser != "" && issue.GithubUser != githubUser {
			continue
		}
		result = append(result, copyIssue(issue))
	}
	return result, nil
}

func (r *MemoryIssueRepository) Transition(_ context.Context, id string, to string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	issue, ok := r.issues[id]
	if !ok {
		return fmt.Errorf("issue %q not found", id)
	}

	if !constants.IsValidTransition(issue.Phase, to) {
		return fmt.Errorf("invalid transition: %s → %s", issue.Phase, to)
	}

	issue.Phase = to
	return nil
}

func (r *MemoryIssueRepository) SetFeedback(_ context.Context, id string, feedback string, maxIterations int) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	issue, ok := r.issues[id]
	if !ok {
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

	return nil
}

func (r *MemoryIssueRepository) StartDeveloping(_ context.Context, id string, workspacePath string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	issue, ok := r.issues[id]
	if !ok {
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
	return nil
}

func (r *MemoryIssueRepository) UpdateOutput(_ context.Context, id string, output string, logs string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	issue, ok := r.issues[id]
	if !ok {
		return fmt.Errorf("issue %q not found", id)
	}

	now := time.Now()
	issue.LastOutput = output
	issue.AgentLogs = logs
	issue.LastRunAt = &now
	return nil
}

func (r *MemoryIssueRepository) CreateWithGithub(_ context.Context, id, title, description, repoPath, githubRepo string, issueNumber int, githubUser string) (*models.Issue, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.issues[id]; exists {
		return nil, fmt.Errorf("issue %q already exists", id)
	}

	issue := &models.Issue{
		IssueID:     id,
		GithubUser:  githubUser,
		Title:       title,
		Description: description,
		Phase:       constants.PhaseBacklog,
		RepoPath:    repoPath,
		GithubRepo:  githubRepo,
		IssueNumber: issueNumber,
	}
	r.issues[id] = issue
	return copyIssue(issue), nil
}

func (r *MemoryIssueRepository) UpdatePR(_ context.Context, id string, prURL string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	issue, ok := r.issues[id]
	if !ok {
		return fmt.Errorf("issue %q not found", id)
	}

	issue.PRURL = prURL
	return nil
}

func (r *MemoryIssueRepository) UpdateCost(_ context.Context, id string, costUSD float64, turns int) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	issue, ok := r.issues[id]
	if !ok {
		return fmt.Errorf("issue %q not found", id)
	}

	issue.CostUSD = costUSD
	issue.Turns = turns
	return nil
}

func copyIssue(src *models.Issue) *models.Issue {
	c := *src
	return &c
}
