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

	"auto-issue/internal/config"
	"auto-issue/internal/constants"
	"auto-issue/internal/models"
	"auto-issue/internal/repository"
	"auto-issue/internal/service"
)

// Handler serves the auto-issue REST API, delegating to the repository
// and orchestrator for issue lifecycle management.
type Handler struct {
	issues     repository.IssueRepository
	configRepo repository.ConfigRepository
	orch       *service.Orchestrator
	config     *config.Config
	startTime  time.Time
}

// NewHandler creates a Handler wired to the given dependencies.
func NewHandler(issues repository.IssueRepository, configRepo repository.ConfigRepository, orch *service.Orchestrator, cfg *config.Config) *Handler {
	return &Handler{
		issues:     issues,
		configRepo: configRepo,
		orch:       orch,
		config:     cfg,
		startTime:  time.Now(),
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

	issues, _ := h.issues.List(r.Context(), "")
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
	issues, _ := h.issues.List(r.Context(), phaseFilter)
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
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	if req.Title == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "title is required")
		return
	}

	id := fmt.Sprintf("issue-%d", time.Now().UnixMilli())
	issue, err := h.issues.Create(r.Context(), id, req.Title, req.Description, req.RepoPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
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
		h.getIssue(w, r, issueID)
		return
	}

	action := parts[1]
	switch action {
	case "move":
		h.moveIssue(w, r, issueID)
	case "feedback":
		h.submitFeedback(w, r, issueID)
	default:
		writeError(w, http.StatusNotFound, "not_found", "unknown action: "+action)
	}
}

func (h *Handler) getIssue(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "only GET is allowed")
		return
	}

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
		h.orch.Enqueue(id)

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
		h.orch.Enqueue(issue.IssueID)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "Feedback submitted, restarting agent",
		"issue":   issue,
	})
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

func readJSON(r *http.Request, dest any) error {
	if r.Body == nil {
		return fmt.Errorf("request body is empty")
	}
	return json.NewDecoder(r.Body).Decode(dest)
}
