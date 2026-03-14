package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"auto-issue/internal/agent"
	"auto-issue/internal/config"
	"auto-issue/internal/orchestrator"
	"auto-issue/internal/state"
	"auto-issue/internal/workspace"
)

func setupTestHandler(t *testing.T) (*Handler, *http.ServeMux) {
	t.Helper()

	tmpDir := t.TempDir()
	statePath := filepath.Join(tmpDir, "state.json")

	st, err := state.NewStore(statePath)
	if err != nil {
		t.Fatalf("creating store: %v", err)
	}

	cfg := &config.Config{
		APIPort:        8080,
		MaxConcurrency: 2,
		Agent: config.AgentConfig{
			Type:          "claude-code",
			Model:         "claude-opus-4-6",
			MaxIterations: 3,
		},
		Workspace: config.WorkspaceConfig{
			BasePath: filepath.Join(tmpDir, "workspaces"),
		},
	}

	wsBasePath := filepath.Join(tmpDir, "workspaces")
	if err := os.MkdirAll(wsBasePath, 0755); err != nil {
		t.Fatalf("creating workspace dir: %v", err)
	}

	wsMgr, err := workspace.NewManager(wsBasePath)
	if err != nil {
		t.Fatalf("creating workspace manager: %v", err)
	}

	ag := agent.NewRunner(cfg.Agent)
	orch := orchestrator.New(wsMgr, st, ag, cfg.MaxConcurrency)
	// Don't call orch.Start() — Enqueue buffers into the channel (capacity 100).

	h := NewHandler(st, orch, cfg)
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	return h, mux
}

func doRequest(t *testing.T, mux *http.ServeMux, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()

	var reqBody *bytes.Buffer
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshalling request body: %v", err)
		}
		reqBody = bytes.NewBuffer(data)
	} else {
		reqBody = &bytes.Buffer{}
	}

	req := httptest.NewRequest(method, path, reqBody)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	return w
}

func decodeResponse(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("decoding response: %v (body: %s)", err, w.Body.String())
	}
	return result
}

func TestGetStatus(t *testing.T) {
	tests := []struct {
		name          string
		setupIssues   func(t *testing.T, h *Handler)
		wantActive    float64
		wantStatus    string
		wantHasUptime bool
	}{
		{
			name:          "no issues",
			setupIssues:   func(t *testing.T, h *Handler) {},
			wantActive:    0,
			wantStatus:    "running",
			wantHasUptime: true,
		},
		{
			name: "with active issues",
			setupIssues: func(t *testing.T, h *Handler) {
				t.Helper()
				if _, err := h.state.Create("active-1", "Active", "desc", "/tmp"); err != nil {
					t.Fatalf("creating issue: %v", err)
				}
				if err := h.state.Transition("active-1", state.PhaseDeveloping); err != nil {
					t.Fatalf("transitioning issue: %v", err)
				}
			},
			wantActive:    1,
			wantStatus:    "running",
			wantHasUptime: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, mux := setupTestHandler(t)
			tt.setupIssues(t, h)

			w := doRequest(t, mux, "GET", "/api/v1/status", nil)
			if w.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d", w.Code)
			}

			resp := decodeResponse(t, w)
			if resp["status"] != tt.wantStatus {
				t.Errorf("status = %v, want %v", resp["status"], tt.wantStatus)
			}
			if tt.wantHasUptime && resp["uptime"] == nil {
				t.Error("expected uptime field")
			}
			if resp["active_issues"].(float64) != tt.wantActive {
				t.Errorf("active_issues = %v, want %v", resp["active_issues"], tt.wantActive)
			}
		})
	}
}

func TestCreateIssue(t *testing.T) {
	tests := []struct {
		name       string
		body       map[string]string
		wantCode   int
		wantPhase  string
		wantTitle  string
		wantErrKey string
	}{
		{
			name:      "valid issue",
			body:      map[string]string{"title": "Test issue", "description": "A test", "repo_path": "/tmp/repo"},
			wantCode:  http.StatusCreated,
			wantPhase: "backlog",
			wantTitle: "Test issue",
		},
		{
			name:       "missing title",
			body:       map[string]string{"description": "no title"},
			wantCode:   http.StatusBadRequest,
			wantErrKey: "invalid_request",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, mux := setupTestHandler(t)

			w := doRequest(t, mux, "POST", "/api/v1/issues", tt.body)
			if w.Code != tt.wantCode {
				t.Fatalf("status = %d, want %d: %s", w.Code, tt.wantCode, w.Body.String())
			}

			resp := decodeResponse(t, w)
			if tt.wantErrKey != "" {
				if resp["error"] != tt.wantErrKey {
					t.Errorf("error = %v, want %v", resp["error"], tt.wantErrKey)
				}
				return
			}
			if resp["phase"] != tt.wantPhase {
				t.Errorf("phase = %v, want %v", resp["phase"], tt.wantPhase)
			}
			if resp["title"] != tt.wantTitle {
				t.Errorf("title = %v, want %v", resp["title"], tt.wantTitle)
			}
			if resp["id"] == nil || resp["id"] == "" {
				t.Error("expected non-empty id")
			}
		})
	}
}

func TestListIssues(t *testing.T) {
	tests := []struct {
		name      string
		phase     string
		wantTotal float64
	}{
		{name: "all issues", phase: "", wantTotal: 2},
		{name: "filter backlog", phase: "backlog", wantTotal: 2},
		{name: "filter developing", phase: "developing", wantTotal: 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, mux := setupTestHandler(t)

			if _, err := h.state.Create("list-1", "Issue 1", "desc1", "/tmp/repo"); err != nil {
				t.Fatalf("creating issue: %v", err)
			}
			if _, err := h.state.Create("list-2", "Issue 2", "desc2", "/tmp/repo"); err != nil {
				t.Fatalf("creating issue: %v", err)
			}

			path := "/api/v1/issues"
			if tt.phase != "" {
				path += "?phase=" + tt.phase
			}

			w := doRequest(t, mux, "GET", path, nil)
			if w.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", w.Code)
			}

			resp := decodeResponse(t, w)
			if resp["total"].(float64) != tt.wantTotal {
				t.Errorf("total = %v, want %v", resp["total"], tt.wantTotal)
			}
		})
	}
}

func TestGetIssue(t *testing.T) {
	tests := []struct {
		name     string
		issueID  string
		create   bool
		wantCode int
	}{
		{name: "existing issue", issueID: "get-1", create: true, wantCode: http.StatusOK},
		{name: "not found", issueID: "nonexistent", create: false, wantCode: http.StatusNotFound},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, mux := setupTestHandler(t)

			if tt.create {
				if _, err := h.state.Create(tt.issueID, "Get me", "desc", "/tmp/repo"); err != nil {
					t.Fatalf("creating issue: %v", err)
				}
			}

			w := doRequest(t, mux, "GET", "/api/v1/issues/"+tt.issueID, nil)
			if w.Code != tt.wantCode {
				t.Fatalf("status = %d, want %d: %s", w.Code, tt.wantCode, w.Body.String())
			}

			if tt.create {
				resp := decodeResponse(t, w)
				if resp["id"] != tt.issueID {
					t.Errorf("id = %v, want %v", resp["id"], tt.issueID)
				}
			}
		})
	}
}

func TestMoveIssue(t *testing.T) {
	tests := []struct {
		name       string
		setupPhase func(t *testing.T, h *Handler)
		moveTo     string
		wantCode   int
		wantPhase  string
		wantErrKey string
	}{
		{
			name:       "backlog to in_progress",
			setupPhase: func(t *testing.T, h *Handler) {},
			moveTo:     "in_progress",
			wantCode:   http.StatusOK,
			wantPhase:  "developing",
		},
		{
			name: "human_review to done",
			setupPhase: func(t *testing.T, h *Handler) {
				t.Helper()
				if err := h.state.Transition("move-test", state.PhaseDeveloping); err != nil {
					t.Fatalf("transition: %v", err)
				}
				if err := h.state.Transition("move-test", state.PhaseCodeReviewing); err != nil {
					t.Fatalf("transition: %v", err)
				}
				if err := h.state.Transition("move-test", state.PhaseHumanReview); err != nil {
					t.Fatalf("transition: %v", err)
				}
			},
			moveTo:    "done",
			wantCode:  http.StatusOK,
			wantPhase: "done",
		},
		{
			name:       "invalid backlog to done",
			setupPhase: func(t *testing.T, h *Handler) {},
			moveTo:     "done",
			wantCode:   http.StatusConflict,
			wantErrKey: "invalid_transition",
		},
		{
			name:       "invalid target",
			setupPhase: func(t *testing.T, h *Handler) {},
			moveTo:     "garbage",
			wantCode:   http.StatusBadRequest,
			wantErrKey: "invalid_request",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, mux := setupTestHandler(t)

			if _, err := h.state.Create("move-test", "Move me", "desc", "/tmp/repo"); err != nil {
				t.Fatalf("creating issue: %v", err)
			}
			tt.setupPhase(t, h)

			w := doRequest(t, mux, "PUT", "/api/v1/issues/move-test/move", map[string]string{"to": tt.moveTo})
			if w.Code != tt.wantCode {
				t.Fatalf("status = %d, want %d: %s", w.Code, tt.wantCode, w.Body.String())
			}

			resp := decodeResponse(t, w)
			if tt.wantErrKey != "" {
				if resp["error"] != tt.wantErrKey {
					t.Errorf("error = %v, want %v", resp["error"], tt.wantErrKey)
				}
				return
			}

			issueResp, ok := resp["issue"].(map[string]any)
			if !ok {
				t.Fatal("expected issue in response")
			}
			if issueResp["phase"] != tt.wantPhase {
				t.Errorf("phase = %v, want %v", issueResp["phase"], tt.wantPhase)
			}
		})
	}
}

func TestFeedback(t *testing.T) {
	tests := []struct {
		name       string
		startPhase state.Phase
		feedback   string
		wantCode   int
		wantPhase  string
		wantErrKey string
	}{
		{
			name:       "valid feedback from human_review",
			startPhase: state.PhaseHumanReview,
			feedback:   "Please refactor",
			wantCode:   http.StatusOK,
			wantPhase:  "developing",
		},
		{
			name:       "feedback on wrong phase",
			startPhase: state.PhaseBacklog,
			feedback:   "This shouldn't work",
			wantCode:   http.StatusConflict,
			wantErrKey: "invalid_phase",
		},
		{
			name:       "empty feedback",
			startPhase: state.PhaseHumanReview,
			feedback:   "",
			wantCode:   http.StatusBadRequest,
			wantErrKey: "invalid_request",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, mux := setupTestHandler(t)

			if _, err := h.state.Create("fb-test", "Feedback issue", "desc", "/tmp/repo"); err != nil {
				t.Fatalf("creating issue: %v", err)
			}

			// Walk to the desired start phase.
			phases := phasePath(tt.startPhase)
			for _, p := range phases {
				if err := h.state.Transition("fb-test", p); err != nil {
					t.Fatalf("transitioning to %s: %v", p, err)
				}
			}

			w := doRequest(t, mux, "POST", "/api/v1/issues/fb-test/feedback", map[string]string{"feedback": tt.feedback})
			if w.Code != tt.wantCode {
				t.Fatalf("status = %d, want %d: %s", w.Code, tt.wantCode, w.Body.String())
			}

			resp := decodeResponse(t, w)
			if tt.wantErrKey != "" {
				if resp["error"] != tt.wantErrKey {
					t.Errorf("error = %v, want %v", resp["error"], tt.wantErrKey)
				}
				return
			}

			issueResp, ok := resp["issue"].(map[string]any)
			if !ok {
				t.Fatal("expected issue in response")
			}
			if issueResp["phase"] != tt.wantPhase {
				t.Errorf("phase = %v, want %v", issueResp["phase"], tt.wantPhase)
			}
		})
	}
}

func TestGetConfig(t *testing.T) {
	_, mux := setupTestHandler(t)

	w := doRequest(t, mux, "GET", "/api/v1/config", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	resp := decodeResponse(t, w)
	if resp["api_port"].(float64) != 8080 {
		t.Errorf("api_port = %v, want 8080", resp["api_port"])
	}

	agentCfg, ok := resp["agent"].(map[string]any)
	if !ok {
		t.Fatal("expected agent config in response")
	}
	if agentCfg["model"] != "claude-opus-4-6" {
		t.Errorf("agent.model = %v, want claude-opus-4-6", agentCfg["model"])
	}
}

// phasePath returns the sequence of transitions needed to reach the target
// phase from backlog.
func phasePath(target state.Phase) []state.Phase {
	switch target {
	case state.PhaseBacklog:
		return nil
	case state.PhaseDeveloping:
		return []state.Phase{state.PhaseDeveloping}
	case state.PhaseCodeReviewing:
		return []state.Phase{state.PhaseDeveloping, state.PhaseCodeReviewing}
	case state.PhaseHumanReview:
		return []state.Phase{state.PhaseDeveloping, state.PhaseCodeReviewing, state.PhaseHumanReview}
	default:
		return nil
	}
}
