package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"auto-issue/internal/config"
	"auto-issue/internal/constants"
	"auto-issue/internal/repository"
	"auto-issue/internal/service"
	"auto-issue/internal/workspace"
)

func setupTestHandler(t *testing.T) (*Handler, *http.ServeMux) {
	t.Helper()

	tmpDir := t.TempDir()

	issueRepo := repository.NewMemoryIssueRepository()

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

	broadcaster := NewBroadcaster()
	orch := service.NewOrchestrator(wsMgr, issueRepo, cfg.Agent, cfg.Agent.APIKeys, broadcaster, "", cfg.MaxConcurrency)

	h := NewHandler(issueRepo, nil, orch, cfg, broadcaster)
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
				ctx := t.Context()
				if _, err := h.issues.Create(ctx, "active-1", "Active", "desc", "/tmp", "testuser"); err != nil {
					t.Fatalf("creating issue: %v", err)
				}
				if err := h.issues.Transition(ctx, "active-1", constants.PhaseDeveloping); err != nil {
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
			body:      map[string]string{"title": "Test issue", "description": "A test", "repo_path": "/tmp/repo", "github_user": "testuser"},
			wantCode:  http.StatusCreated,
			wantPhase: "backlog",
			wantTitle: "Test issue",
		},
		{
			name:       "missing title",
			body:       map[string]string{"description": "no title", "github_user": "testuser"},
			wantCode:   http.StatusBadRequest,
			wantErrKey: "invalid_request",
		},
		{
			name:       "missing github_user",
			body:       map[string]string{"title": "Test issue", "description": "A test"},
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

func TestCreateIssueWithAgentType(t *testing.T) {
	_, mux := setupTestHandler(t)

	// Valid agent_type
	w := doRequest(t, mux, "POST", "/api/v1/issues", map[string]any{
		"title":       "Test with codex",
		"description": "Use codex agent",
		"repo_path":   "/tmp/repo",
		"agent_type":  "codex",
		"agent_model":  "o3-mini",
		"github_user": "testuser",
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201: %s", w.Code, w.Body.String())
	}
	resp := decodeResponse(t, w)
	if resp["agent_type"] != "codex" {
		t.Errorf("agent_type = %v, want codex", resp["agent_type"])
	}
	if resp["agent_model"] != "o3-mini" {
		t.Errorf("agent_model = %v, want o3-mini", resp["agent_model"])
	}

	// Invalid agent_type
	w2 := doRequest(t, mux, "POST", "/api/v1/issues", map[string]any{
		"title":       "Test with invalid",
		"agent_type":  "invalid-provider",
		"github_user": "testuser",
	})
	if w2.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400: %s", w2.Code, w2.Body.String())
	}
	resp2 := decodeResponse(t, w2)
	if resp2["error"] != "invalid_request" {
		t.Errorf("error = %v, want invalid_request", resp2["error"])
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
			ctx := t.Context()

			if _, err := h.issues.Create(ctx, "list-1", "Issue 1", "desc1", "/tmp/repo", "testuser"); err != nil {
				t.Fatalf("creating issue: %v", err)
			}
			if _, err := h.issues.Create(ctx, "list-2", "Issue 2", "desc2", "/tmp/repo", "testuser"); err != nil {
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
				if _, err := h.issues.Create(t.Context(), tt.issueID, "Get me", "desc", "/tmp/repo", "testuser"); err != nil {
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
				ctx := t.Context()
				h.issues.Transition(ctx, "move-test", constants.PhaseDeveloping)
				h.issues.Transition(ctx, "move-test", constants.PhaseCodeReviewing)
				h.issues.Transition(ctx, "move-test", constants.PhaseHumanReview)
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

			if _, err := h.issues.Create(t.Context(), "move-test", "Move me", "desc", "/tmp/repo", "testuser"); err != nil {
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
		startPhase string
		feedback   string
		wantCode   int
		wantPhase  string
		wantErrKey string
	}{
		{
			name:       "valid feedback from human_review",
			startPhase: constants.PhaseHumanReview,
			feedback:   "Please refactor",
			wantCode:   http.StatusOK,
			wantPhase:  "developing",
		},
		{
			name:       "feedback on wrong phase",
			startPhase: constants.PhaseBacklog,
			feedback:   "This shouldn't work",
			wantCode:   http.StatusConflict,
			wantErrKey: "invalid_phase",
		},
		{
			name:       "empty feedback",
			startPhase: constants.PhaseHumanReview,
			feedback:   "",
			wantCode:   http.StatusBadRequest,
			wantErrKey: "invalid_request",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, mux := setupTestHandler(t)
			ctx := t.Context()

			if _, err := h.issues.Create(ctx, "fb-test", "Feedback issue", "desc", "/tmp/repo", "testuser"); err != nil {
				t.Fatalf("creating issue: %v", err)
			}

			phases := phasePath(tt.startPhase)
			for _, p := range phases {
				if err := h.issues.Transition(ctx, "fb-test", p); err != nil {
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

// phasePath returns the sequence of transitions needed to reach the target phase from backlog.
func phasePath(target string) []string {
	switch target {
	case constants.PhaseBacklog:
		return nil
	case constants.PhaseDeveloping:
		return []string{constants.PhaseDeveloping}
	case constants.PhaseCodeReviewing:
		return []string{constants.PhaseDeveloping, constants.PhaseCodeReviewing}
	case constants.PhaseHumanReview:
		return []string{constants.PhaseDeveloping, constants.PhaseCodeReviewing, constants.PhaseHumanReview}
	default:
		return nil
	}
}
