package state

import (
	"path/filepath"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	path := filepath.Join(t.TempDir(), "state.json")
	s, err := NewStore(path)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	return s
}

func TestCreateAndGet(t *testing.T) {
	s := newTestStore(t)

	issue, err := s.Create("issue-1", "Add auth", "Implement JWT auth", "/home/user/repo")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if issue.Phase != PhaseBacklog {
		t.Errorf("phase = %s, want backlog", issue.Phase)
	}

	got, err := s.Get("issue-1")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Title != "Add auth" {
		t.Errorf("title = %q, want %q", got.Title, "Add auth")
	}
}

func TestCreateDuplicate(t *testing.T) {
	s := newTestStore(t)
	s.Create("issue-1", "Title", "Desc", "/repo")

	_, err := s.Create("issue-1", "Title2", "Desc2", "/repo")
	if err == nil {
		t.Fatal("expected error for duplicate issue")
	}
}

func TestGetNotFound(t *testing.T) {
	s := newTestStore(t)
	_, err := s.Get("nonexistent")
	if err == nil {
		t.Fatal("expected error for missing issue")
	}
}

func TestListAll(t *testing.T) {
	s := newTestStore(t)
	s.Create("issue-1", "A", "a", "/repo")
	s.Create("issue-2", "B", "b", "/repo")

	all := s.List("")
	if len(all) != 2 {
		t.Errorf("List() returned %d issues, want 2", len(all))
	}
}

func TestListFilterByPhase(t *testing.T) {
	s := newTestStore(t)
	s.Create("issue-1", "A", "a", "/repo")
	s.Create("issue-2", "B", "b", "/repo")
	s.Transition("issue-1", PhaseDeveloping)

	backlog := s.List(PhaseBacklog)
	if len(backlog) != 1 {
		t.Errorf("List(backlog) returned %d, want 1", len(backlog))
	}

	developing := s.List(PhaseDeveloping)
	if len(developing) != 1 {
		t.Errorf("List(developing) returned %d, want 1", len(developing))
	}
}

func TestFullLifecycle(t *testing.T) {
	s := newTestStore(t)
	s.Create("issue-1", "Feature", "Build it", "/repo")

	// backlog → developing
	if err := s.Transition("issue-1", PhaseDeveloping); err != nil {
		t.Fatalf("backlog→developing: %v", err)
	}

	// developing → code_reviewing
	if err := s.Transition("issue-1", PhaseCodeReviewing); err != nil {
		t.Fatalf("developing→code_reviewing: %v", err)
	}

	// code_reviewing → human_review
	if err := s.Transition("issue-1", PhaseHumanReview); err != nil {
		t.Fatalf("code_reviewing→human_review: %v", err)
	}

	// human_review → done (approve)
	if err := s.Transition("issue-1", PhaseDone); err != nil {
		t.Fatalf("human_review→done: %v", err)
	}

	got, _ := s.Get("issue-1")
	if got.Phase != PhaseDone {
		t.Errorf("phase = %s, want done", got.Phase)
	}
}

func TestFeedbackLoop(t *testing.T) {
	s := newTestStore(t)
	s.Create("issue-1", "Feature", "Build it", "/repo")

	// Move to human_review
	s.Transition("issue-1", PhaseDeveloping)
	s.Transition("issue-1", PhaseCodeReviewing)
	s.Transition("issue-1", PhaseHumanReview)

	// Submit feedback (reprove)
	err := s.SetFeedback("issue-1", "Add unit tests", 3)
	if err != nil {
		t.Fatalf("SetFeedback: %v", err)
	}

	got, _ := s.Get("issue-1")
	if got.Phase != PhaseDeveloping {
		t.Errorf("phase after feedback = %s, want developing", got.Phase)
	}
	if got.Iteration != 1 {
		t.Errorf("iteration = %d, want 1", got.Iteration)
	}
	if got.FeedbackCount != 1 {
		t.Errorf("feedback_count = %d, want 1", got.FeedbackCount)
	}
	if got.LastFeedback != "Add unit tests" {
		t.Errorf("last_feedback = %q, want %q", got.LastFeedback, "Add unit tests")
	}
}

func TestFeedbackExceedsMaxIterations(t *testing.T) {
	s := newTestStore(t)
	s.Create("issue-1", "Feature", "Build it", "/repo")

	// Run through 3 feedback cycles with max_iterations=3
	for i := 0; i < 2; i++ {
		s.Transition("issue-1", PhaseDeveloping)
		s.Transition("issue-1", PhaseCodeReviewing)
		s.Transition("issue-1", PhaseHumanReview)
		s.SetFeedback("issue-1", "try again", 3)
	}

	// Third cycle
	s.Transition("issue-1", PhaseCodeReviewing)
	s.Transition("issue-1", PhaseHumanReview)

	// This should fail the issue (feedback_count=3, max=3)
	s.SetFeedback("issue-1", "still wrong", 3)

	got, _ := s.Get("issue-1")
	if got.Phase != PhaseFailed {
		t.Errorf("phase = %s, want failed after exceeding max iterations", got.Phase)
	}
}

func TestInvalidTransition(t *testing.T) {
	s := newTestStore(t)
	s.Create("issue-1", "Feature", "Build it", "/repo")

	// backlog → done should fail
	err := s.Transition("issue-1", PhaseDone)
	if err == nil {
		t.Fatal("expected error for invalid transition backlog→done")
	}

	// backlog → human_review should fail
	err = s.Transition("issue-1", PhaseHumanReview)
	if err == nil {
		t.Fatal("expected error for invalid transition backlog→human_review")
	}
}

func TestFeedbackWrongPhase(t *testing.T) {
	s := newTestStore(t)
	s.Create("issue-1", "Feature", "Build it", "/repo")

	err := s.SetFeedback("issue-1", "feedback", 3)
	if err == nil {
		t.Fatal("expected error for feedback on backlog issue")
	}
}

func TestPersistenceAcrossRestarts(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "state.json")

	// Create and populate first store
	s1, _ := NewStore(path)
	s1.Create("issue-1", "Persisted", "Data", "/repo")
	s1.Transition("issue-1", PhaseDeveloping)

	// Create second store from same file
	s2, err := NewStore(path)
	if err != nil {
		t.Fatalf("NewStore reload: %v", err)
	}

	got, err := s2.Get("issue-1")
	if err != nil {
		t.Fatalf("Get after reload: %v", err)
	}
	if got.Phase != PhaseDeveloping {
		t.Errorf("phase after reload = %s, want developing", got.Phase)
	}
	if got.Title != "Persisted" {
		t.Errorf("title after reload = %q, want %q", got.Title, "Persisted")
	}
}

func TestStartDeveloping(t *testing.T) {
	s := newTestStore(t)
	s.Create("issue-1", "Feature", "Build it", "/repo")
	s.Transition("issue-1", PhaseDeveloping)

	err := s.StartDeveloping("issue-1", "/tmp/workspace/issue-1")
	if err != nil {
		t.Fatalf("StartDeveloping: %v", err)
	}

	got, _ := s.Get("issue-1")
	if got.Iteration != 1 {
		t.Errorf("iteration = %d, want 1", got.Iteration)
	}
	if got.WorkspacePath != "/tmp/workspace/issue-1" {
		t.Errorf("workspace = %q, want %q", got.WorkspacePath, "/tmp/workspace/issue-1")
	}
	if got.StartedAt.IsZero() {
		t.Error("started_at should be set")
	}
}

func TestUpdateOutput(t *testing.T) {
	s := newTestStore(t)
	s.Create("issue-1", "Feature", "Build it", "/repo")

	err := s.UpdateOutput("issue-1", "solution code", "log output")
	if err != nil {
		t.Fatalf("UpdateOutput: %v", err)
	}

	got, _ := s.Get("issue-1")
	if got.LastOutput != "solution code" {
		t.Errorf("last_output = %q, want %q", got.LastOutput, "solution code")
	}
	if got.AgentLogs != "log output" {
		t.Errorf("agent_logs = %q, want %q", got.AgentLogs, "log output")
	}
}
