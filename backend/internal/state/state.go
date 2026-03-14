package state

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Phase string

const (
	PhaseBacklog       Phase = "backlog"
	PhaseDeveloping    Phase = "developing"
	PhaseCodeReviewing Phase = "code_reviewing"
	PhaseHumanReview   Phase = "human_review"
	PhaseDone          Phase = "done"
	PhaseFailed        Phase = "failed"
)

type IssueState struct {
	IssueID       string    `json:"id"`
	Title         string    `json:"title"`
	Description   string    `json:"description"`
	Phase         Phase     `json:"phase"`
	Iteration     int       `json:"iteration"`
	WorkspacePath string    `json:"workspace_path"`
	RepoPath      string    `json:"repo_path"`
	StartedAt     time.Time `json:"started_at"`
	LastFeedback  string    `json:"last_feedback,omitempty"`
	FeedbackCount int       `json:"feedback_count"`
	LastOutput    string    `json:"last_output,omitempty"`
	AgentLogs     string    `json:"agent_logs,omitempty"`
	LastRunAt     time.Time `json:"last_run_at,omitempty"`
}

// validTransitions defines which phase transitions are allowed.
// Internal transitions (developing → code_reviewing → human_review) are driven
// by the orchestrator, not by API callers directly.
var validTransitions = map[Phase][]Phase{
	PhaseBacklog:       {PhaseDeveloping},
	PhaseDeveloping:    {PhaseCodeReviewing, PhaseFailed},
	PhaseCodeReviewing: {PhaseHumanReview, PhaseFailed},
	PhaseHumanReview:   {PhaseDeveloping, PhaseDone},
}

type Store struct {
	mu       sync.RWMutex
	issues   map[string]*IssueState
	filePath string
}

// NewStore creates a store that persists to the given file path.
// If the file exists, it loads existing state.
func NewStore(filePath string) (*Store, error) {
	s := &Store{
		issues:   make(map[string]*IssueState),
		filePath: filePath,
	}

	if _, err := os.Stat(filePath); err == nil {
		if err := s.loadFromDisk(); err != nil {
			return nil, fmt.Errorf("loading state: %w", err)
		}
	}

	return s, nil
}

// Create adds a new issue in backlog phase.
func (s *Store) Create(id, title, description, repoPath string) (*IssueState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.issues[id]; exists {
		return nil, fmt.Errorf("issue %q already exists", id)
	}

	issue := &IssueState{
		IssueID:     id,
		Title:       title,
		Description: description,
		Phase:       PhaseBacklog,
		Iteration:   0,
		RepoPath:    repoPath,
	}
	s.issues[id] = issue

	if err := s.persistLocked(); err != nil {
		return nil, err
	}
	return issue, nil
}

// Get returns a copy of the issue state.
func (s *Store) Get(id string) (*IssueState, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	issue, ok := s.issues[id]
	if !ok {
		return nil, fmt.Errorf("issue %q not found", id)
	}

	copy := *issue
	return &copy, nil
}

// List returns copies of all issues, optionally filtered by phase.
func (s *Store) List(phaseFilter Phase) []*IssueState {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*IssueState
	for _, issue := range s.issues {
		if phaseFilter != "" && issue.Phase != phaseFilter {
			continue
		}
		copy := *issue
		result = append(result, &copy)
	}
	return result
}

// Transition moves an issue to a new phase if the transition is valid.
func (s *Store) Transition(id string, to Phase) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	issue, ok := s.issues[id]
	if !ok {
		return fmt.Errorf("issue %q not found", id)
	}

	if !isValidTransition(issue.Phase, to) {
		return fmt.Errorf("invalid transition: %s → %s", issue.Phase, to)
	}

	issue.Phase = to
	return s.persistLocked()
}

// SetFeedback records human feedback and moves issue back to developing.
func (s *Store) SetFeedback(id string, feedback string, maxIterations int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	issue, ok := s.issues[id]
	if !ok {
		return fmt.Errorf("issue %q not found", id)
	}

	if issue.Phase != PhaseHumanReview {
		return fmt.Errorf("feedback only valid in human_review phase, current: %s", issue.Phase)
	}

	issue.FeedbackCount++
	if issue.FeedbackCount >= maxIterations {
		issue.Phase = PhaseFailed
		issue.LastFeedback = feedback
		return s.persistLocked()
	}

	issue.LastFeedback = feedback
	issue.Iteration++
	issue.Phase = PhaseDeveloping
	return s.persistLocked()
}

// StartDeveloping sets up the issue for a development run.
func (s *Store) StartDeveloping(id string, workspacePath string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	issue, ok := s.issues[id]
	if !ok {
		return fmt.Errorf("issue %q not found", id)
	}

	if issue.Phase != PhaseDeveloping {
		return fmt.Errorf("issue must be in developing phase, current: %s", issue.Phase)
	}

	if issue.Iteration == 0 {
		issue.Iteration = 1
		issue.StartedAt = time.Now()
	}
	issue.WorkspacePath = workspacePath
	issue.LastRunAt = time.Now()
	return s.persistLocked()
}

// UpdateOutput stores the agent's output and logs.
func (s *Store) UpdateOutput(id string, output string, logs string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	issue, ok := s.issues[id]
	if !ok {
		return fmt.Errorf("issue %q not found", id)
	}

	issue.LastOutput = output
	issue.AgentLogs = logs
	issue.LastRunAt = time.Now()
	return s.persistLocked()
}

func isValidTransition(from, to Phase) bool {
	targets, ok := validTransitions[from]
	if !ok {
		return false
	}
	for _, t := range targets {
		if t == to {
			return true
		}
	}
	return false
}

func (s *Store) loadFromDisk() error {
	data, err := os.ReadFile(s.filePath)
	if err != nil {
		return err
	}

	var issues []*IssueState
	if err := json.Unmarshal(data, &issues); err != nil {
		return fmt.Errorf("parsing state file: %w", err)
	}

	for _, issue := range issues {
		s.issues[issue.IssueID] = issue
	}
	return nil
}

// persistLocked writes state to disk. Caller must hold s.mu.
func (s *Store) persistLocked() error {
	issues := make([]*IssueState, 0, len(s.issues))
	for _, issue := range s.issues {
		issues = append(issues, issue)
	}

	data, err := json.MarshalIndent(issues, "", "  ")
	if err != nil {
		return fmt.Errorf("marshalling state: %w", err)
	}

	dir := filepath.Dir(s.filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("creating state directory: %w", err)
	}

	return os.WriteFile(s.filePath, data, 0644)
}
