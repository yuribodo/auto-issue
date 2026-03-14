// Package api provides HTTP handlers that wire the Electron frontend
// to the backend by exposing REST endpoints for Kanban board operations.
package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"auto-issue/internal/config"
	"auto-issue/internal/orchestrator"
	"auto-issue/internal/state"
)

// Handler serves the auto-issue REST API, delegating to the state store
// and orchestrator for issue lifecycle management.
type Handler struct {
	state        *state.Store
	orchestrator *orchestrator.Orchestrator
	config       *config.Config
	startTime    time.Time
}

// NewHandler creates a Handler wired to the given state store, orchestrator,
// and configuration. The handler's uptime is measured from creation time.
func NewHandler(st *state.Store, orch *orchestrator.Orchestrator, cfg *config.Config) *Handler {
	return &Handler{
		state:        st,
		orchestrator: orch,
		config:       cfg,
		startTime:    time.Now(),
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

	issues := h.state.List("")
	active := 0
	for _, issue := range issues {
		if issue.Phase == state.PhaseDeveloping || issue.Phase == state.PhaseCodeReviewing {
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
	phaseFilter := state.Phase(r.URL.Query().Get("phase"))
	issues := h.state.List(phaseFilter)
	if issues == nil {
		issues = []*state.IssueState{}
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
	issue, err := h.state.Create(id, req.Title, req.Description, req.RepoPath)
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

	issue, err := h.state.Get(id)
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

	switch req.To {
	case "in_progress":
		if err := h.state.Transition(id, state.PhaseDeveloping); err != nil {
			writeError(w, http.StatusConflict, "invalid_transition", err.Error())
			return
		}
		h.orchestrator.Enqueue(id)

		issue, err := h.state.Get(id)
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
		if err := h.state.Transition(id, state.PhaseDone); err != nil {
			writeError(w, http.StatusConflict, "invalid_transition", err.Error())
			return
		}

		issue, err := h.state.Get(id)
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

	if err := h.state.SetFeedback(id, req.Feedback, h.config.Agent.MaxIterations); err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, "not_found", err.Error())
		} else {
			writeError(w, http.StatusConflict, "invalid_phase", err.Error())
		}
		return
	}

	issue, err := h.state.Get(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", fmt.Errorf("fetching issue after feedback: %w", err).Error())
		return
	}

	// If the issue went back to developing (not failed), enqueue it.
	if issue.Phase == state.PhaseDeveloping {
		h.orchestrator.Enqueue(issue.IssueID)
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

	cfg, err := config.Load(config.DefaultConfigPath())
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

// writeJSON encodes data as JSON and writes it with the given status code.
func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		http.Error(w, fmt.Errorf("encoding response: %w", err).Error(), http.StatusInternalServerError)
	}
}

// writeError writes a structured error response per the API.md spec.
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

// readJSON decodes the request body into dest.
func readJSON(r *http.Request, dest any) error {
	if r.Body == nil {
		return fmt.Errorf("request body is empty")
	}
	return json.NewDecoder(r.Body).Decode(dest)
}
