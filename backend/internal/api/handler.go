// Package api provides HTTP handlers that wire the frontend
// to the backend by exposing REST endpoints for Kanban board operations.
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"os/exec"

	"auto-issue/internal/config"
	"auto-issue/internal/constants"
	"auto-issue/internal/models"
	"auto-issue/internal/repository"
	"auto-issue/internal/service"
)

// Handler serves the auto-issue REST API, delegating to the repository
// and orchestrator for issue lifecycle management.
type Handler struct {
	issues      repository.IssueRepository
	configRepo  repository.ConfigRepository
	orch        *service.Orchestrator
	config      *config.Config
	broadcaster *Broadcaster
	startTime   time.Time
}

// NewHandler creates a Handler wired to the given dependencies.
func NewHandler(issues repository.IssueRepository, configRepo repository.ConfigRepository, orch *service.Orchestrator, cfg *config.Config, broadcaster *Broadcaster) *Handler {
	return &Handler{
		issues:      issues,
		configRepo:  configRepo,
		orch:        orch,
		config:      cfg,
		broadcaster: broadcaster,
		startTime:   time.Now(),
	}
}

// RegisterRoutes registers all API v1 endpoints on the given mux.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/v1/status", h.handleStatus)
	mux.HandleFunc("/api/v1/issues", h.handleIssues)
	mux.HandleFunc("/api/v1/issues/", h.handleIssueByPath)
	mux.HandleFunc("/api/v1/config", h.handleGetConfig)
	mux.HandleFunc("/api/v1/config/reload", h.handleConfigReload)
}

func (h *Handler) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only GET is allowed")
		return
	}

	issues, _ := h.issues.List(r.Context(), "", "")
	active := 0
	for _, issue := range issues {
		if issue.Phase == constants.PhaseDeveloping || issue.Phase == constants.PhaseCodeReviewing {
			active++
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":        "running",
		"uptime":        time.Since(h.startTime).Round(time.Second).String(),
		"active_issues": active,
	})
}

func (h *Handler) handleIssues(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.listIssues(w, r)
	case http.MethodPost:
		h.createIssue(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only GET and POST are allowed")
	}
}

func (h *Handler) listIssues(w http.ResponseWriter, r *http.Request) {
	phaseFilter := r.URL.Query().Get("phase")
	githubUser := r.URL.Query().Get("github_user")
	issues, _ := h.issues.List(r.Context(), phaseFilter, githubUser)
	if issues == nil {
		issues = []*models.Issue{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"issues": issues,
		"total":  len(issues),
	})
}

func (h *Handler) createIssue(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		RepoPath    string `json:"repo_path"`
		GithubRepo  string `json:"github_repo"`
		IssueNumber int    `json:"issue_number"`
		AgentType   string `json:"agent_type"`
		AgentModel  string `json:"agent_model"`
		GithubUser  string `json:"github_user"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	if req.Title == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "title is required")
		return
	}

	if req.GithubUser == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "github_user is required")
		return
	}

	// Validate agent_type if provided
	if req.AgentType != "" {
		validTypes := map[string]bool{"claude-code": true, "codex": true, "gemini": true}
		if !validTypes[req.AgentType] {
			writeError(w, http.StatusBadRequest, "invalid_request", fmt.Sprintf("invalid agent_type: %s (valid: claude-code, codex, gemini)", req.AgentType))
			return
		}
	}

	id := fmt.Sprintf("issue-%d", time.Now().UnixMilli())

	var issue *models.Issue
	var err error
	if req.GithubRepo != "" {
		issue, err = h.issues.CreateWithGithub(r.Context(), id, req.Title, req.Description, req.RepoPath, req.GithubRepo, req.IssueNumber, req.GithubUser)
	} else {
		issue, err = h.issues.Create(r.Context(), id, req.Title, req.Description, req.RepoPath, req.GithubUser)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}

	// Set agent type/model if specified
	if req.AgentType != "" || req.AgentModel != "" {
		if err := h.issues.UpdateAgentInfo(r.Context(), issue.IssueID, req.AgentType, req.AgentModel); err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
			return
		}
		issue.AgentType = req.AgentType
		issue.AgentModel = req.AgentModel
	}

	writeJSON(w, http.StatusCreated, issue)
}

func (h *Handler) handleIssueByPath(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/issues/")
	parts := strings.SplitN(path, "/", 2)
	issueID := parts[0]

	if issueID == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "issue ID is required")
		return
	}

	if len(parts) == 1 {
		switch r.Method {
		case http.MethodGet:
			h.getIssue(w, r, issueID)
		case http.MethodDelete:
			h.deleteIssue(w, r, issueID)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only GET and DELETE are allowed")
		}
		return
	}

	action := parts[1]
	switch action {
	case "move":
		h.moveIssue(w, r, issueID)
	case "feedback":
		h.submitFeedback(w, r, issueID)
	case "events":
		h.streamEvents(w, r, issueID)
	case "cancel":
		h.cancelIssue(w, r, issueID)
	case "diff":
		h.getDiff(w, r, issueID)
	default:
		writeError(w, http.StatusNotFound, "not_found", "unknown action: "+action)
	}
}

func (h *Handler) deleteIssue(w http.ResponseWriter, _ *http.Request, id string) {
	if err := h.issues.Delete(context.Background(), id); err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, "not_found", err.Error())
		} else {
			writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "message": "Issue deleted"})
}

func (h *Handler) cancelIssue(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only POST is allowed")
		return
	}

	issue, err := h.issues.Get(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", err.Error())
		return
	}

	// Only cancel issues that are actively running
	if issue.Phase != constants.PhaseDeveloping && issue.Phase != constants.PhaseCodeReviewing {
		writeError(w, http.StatusConflict, "invalid_phase", fmt.Sprintf("cannot cancel issue in phase %s", issue.Phase))
		return
	}

	// Cancel the agent process
	h.orch.CancelIssue(id)

	// Transition to failed
	if err := h.issues.Transition(r.Context(), id, constants.PhaseFailed); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}

	updated, _ := h.issues.Get(r.Context(), id)
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "Issue cancelled",
		"issue":   updated,
	})
}

func (h *Handler) getIssue(w http.ResponseWriter, r *http.Request, id string) {
	issue, err := h.issues.Get(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, issue)
}

func (h *Handler) moveIssue(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only PUT is allowed")
		return
	}

	var req struct {
		To string `json:"to"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	ctx := r.Context()

	switch req.To {
	case "in_progress":
		if err := h.issues.Transition(ctx, id, constants.PhaseDeveloping); err != nil {
			writeError(w, http.StatusConflict, "invalid_transition", err.Error())
			return
		}
		h.orch.Enqueue(id, extractGHToken(r))

		issue, err := h.issues.Get(ctx, id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", fmt.Errorf("fetching issue after transition: %w", err).Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"success": true,
			"message": "Issue moved to in_progress, agent started",
			"issue":   issue,
		})

	case "done":
		if err := h.issues.Transition(ctx, id, constants.PhaseDone); err != nil {
			writeError(w, http.StatusConflict, "invalid_transition", err.Error())
			return
		}

		issue, err := h.issues.Get(ctx, id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", fmt.Errorf("fetching issue after transition: %w", err).Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"success": true,
			"message": "Issue moved to done",
			"issue":   issue,
		})

	default:
		writeError(w, http.StatusBadRequest, "invalid_request", "valid targets: in_progress, done")
	}
}

func (h *Handler) submitFeedback(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only POST is allowed")
		return
	}

	var req struct {
		Feedback string `json:"feedback"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	if req.Feedback == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "feedback is required")
		return
	}

	ctx := r.Context()

	if err := h.issues.SetFeedback(ctx, id, req.Feedback, h.config.Agent.MaxIterations); err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, "not_found", err.Error())
		} else {
			writeError(w, http.StatusConflict, "invalid_phase", err.Error())
		}
		return
	}

	issue, err := h.issues.Get(ctx, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", fmt.Errorf("fetching issue after feedback: %w", err).Error())
		return
	}

	if issue.Phase == constants.PhaseDeveloping {
		h.orch.Enqueue(issue.IssueID, extractGHToken(r))
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "Feedback submitted, restarting agent",
		"issue":   issue,
	})
}

func (h *Handler) streamEvents(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only GET is allowed")
		return
	}

	// Verify issue exists
	if _, err := h.issues.Get(r.Context(), id); err != nil {
		writeError(w, http.StatusNotFound, "not_found", err.Error())
		return
	}

	h.broadcaster.ServeSSE(w, r, id)
}

func (h *Handler) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only GET is allowed")
		return
	}

	writeJSON(w, http.StatusOK, h.config)
}

func (h *Handler) handleConfigReload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only POST is allowed")
		return
	}

	cfg, err := h.configRepo.Load(context.Background())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "config_error", err.Error())
		return
	}

	h.config = cfg
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "Config reloaded successfully",
	})
}

func (h *Handler) getDiff(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only GET is allowed")
		return
	}

	issue, err := h.issues.Get(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", err.Error())
		return
	}

	if issue.WorkspacePath == "" {
		writeError(w, http.StatusBadRequest, "no_workspace", "issue has no workspace path")
		return
	}

	// Get diff stat
	statCmd := exec.Command("git", "diff", "HEAD~1", "--stat")
	statCmd.Dir = issue.WorkspacePath
	statOutput, err := statCmd.Output()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "git_error", fmt.Sprintf("git diff --stat failed: %v", err))
		return
	}

	// Get full diff
	diffCmd := exec.Command("git", "diff", "HEAD~1")
	diffCmd.Dir = issue.WorkspacePath
	diffOutput, err := diffCmd.Output()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "git_error", fmt.Sprintf("git diff failed: %v", err))
		return
	}

	// Parse diff into structured response
	type DiffFile struct {
		Path      string `json:"path"`
		Status    string `json:"status"`
		Additions int    `json:"additions"`
		Deletions int    `json:"deletions"`
		Patch     string `json:"patch"`
	}

	type DiffSummary struct {
		FilesChanged int `json:"files_changed"`
		LinesAdded   int `json:"lines_added"`
		LinesRemoved int `json:"lines_removed"`
	}

	files := []DiffFile{}
	totalAdded := 0
	totalRemoved := 0

	// Parse the unified diff output into per-file patches
	diffStr := string(diffOutput)
	fileDiffs := strings.Split(diffStr, "diff --git ")

	for _, fd := range fileDiffs {
		if fd == "" {
			continue
		}

		lines := strings.SplitN(fd, "\n", 2)
		if len(lines) < 1 {
			continue
		}

		// Extract file path from "a/path b/path"
		parts := strings.Fields(lines[0])
		filePath := ""
		if len(parts) >= 2 {
			filePath = strings.TrimPrefix(parts[1], "b/")
		}

		patch := "diff --git " + fd
		added := 0
		removed := 0

		for _, line := range strings.Split(fd, "\n") {
			if strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++") {
				added++
			} else if strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---") {
				removed++
			}
		}

		status := "modified"
		if strings.Contains(fd, "new file mode") {
			status = "added"
		} else if strings.Contains(fd, "deleted file mode") {
			status = "deleted"
		}

		files = append(files, DiffFile{
			Path:      filePath,
			Status:    status,
			Additions: added,
			Deletions: removed,
			Patch:     patch,
		})

		totalAdded += added
		totalRemoved += removed
	}

	_ = statOutput // stat was used for validation; structured data comes from full diff

	writeJSON(w, http.StatusOK, map[string]any{
		"files": files,
		"summary": DiffSummary{
			FilesChanged: len(files),
			LinesAdded:   totalAdded,
			LinesRemoved: totalRemoved,
		},
	})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		http.Error(w, fmt.Errorf("encoding response: %w", err).Error(), http.StatusInternalServerError)
	}
}

func writeError(w http.ResponseWriter, status int, code string, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(map[string]string{
		"error":     code,
		"message":   message,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		http.Error(w, fmt.Errorf("encoding error response: %w", err).Error(), http.StatusInternalServerError)
	}
}

// extractGHToken pulls the GitHub token from the Authorization header.
// Supports "Bearer <token>" and "token <token>" formats.
func extractGHToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return ""
	}
	parts := strings.SplitN(auth, " ", 2)
	if len(parts) == 2 {
		return parts[1]
	}
	return auth
}

func readJSON(r *http.Request, dest any) error {
	if r.Body == nil {
		return fmt.Errorf("request body is empty")
	}
	return json.NewDecoder(r.Body).Decode(dest)
}
