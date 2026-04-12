package repository

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"auto-issue/internal/models"
)

type APIIssueRepository struct {
	baseURL    string
	authToken  string
	httpClient *http.Client
}

func NewAPIIssueRepository(baseURL string, authToken string) *APIIssueRepository {
	return &APIIssueRepository{
		baseURL:   baseURL,
		authToken: authToken,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

var _ IssueRepository = (*APIIssueRepository)(nil)

func (r *APIIssueRepository) doRequest(ctx context.Context, method, path string, body any) (*http.Response, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshalling request body: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(ctx, method, r.baseURL+path, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if r.authToken != "" {
		req.Header.Set("Authorization", "Bearer "+r.authToken)
	}

	return r.httpClient.Do(req)
}

func (r *APIIssueRepository) parseIssue(resp *http.Response) (*models.Issue, error) {
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
	}
	var issue models.Issue
	if err := json.NewDecoder(resp.Body).Decode(&issue); err != nil {
		return nil, fmt.Errorf("decoding issue: %w", err)
	}
	return &issue, nil
}

func (r *APIIssueRepository) parseError(resp *http.Response) error {
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

func (r *APIIssueRepository) Create(ctx context.Context, id, title, description, repoPath, githubUser string) (*models.Issue, error) {
	resp, err := r.doRequest(ctx, http.MethodPost, "/api/v1/issues", map[string]any{
		"title":       title,
		"description": description,
		"repo_path":   repoPath,
		"github_user": githubUser,
	})
	if err != nil {
		return nil, err
	}
	return r.parseIssue(resp)
}

func (r *APIIssueRepository) CreateWithGithub(ctx context.Context, id, title, description, repoPath, githubRepo string, issueNumber int, githubUser string) (*models.Issue, error) {
	resp, err := r.doRequest(ctx, http.MethodPost, "/api/v1/issues", map[string]any{
		"title":        title,
		"description":  description,
		"repo_path":    repoPath,
		"github_repo":  githubRepo,
		"issue_number": issueNumber,
		"github_user":  githubUser,
	})
	if err != nil {
		return nil, err
	}
	return r.parseIssue(resp)
}

func (r *APIIssueRepository) Get(ctx context.Context, id string) (*models.Issue, error) {
	resp, err := r.doRequest(ctx, http.MethodGet, "/api/v1/issues/"+id, nil)
	if err != nil {
		return nil, err
	}
	return r.parseIssue(resp)
}

func (r *APIIssueRepository) List(ctx context.Context, phaseFilter, githubUser string) ([]*models.Issue, error) {
	params := url.Values{}
	if phaseFilter != "" {
		params.Set("phase", phaseFilter)
	}
	if githubUser != "" {
		params.Set("github_user", githubUser)
	}

	path := "/api/v1/issues"
	if len(params) > 0 {
		path += "?" + params.Encode()
	}

	resp, err := r.doRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Issues []*models.Issue `json:"issues"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding issues list: %w", err)
	}
	return result.Issues, nil
}

func (r *APIIssueRepository) Transition(ctx context.Context, id string, to string) error {
	resp, err := r.doRequest(ctx, http.MethodPut, "/api/v1/issues/"+id+"/transition", map[string]any{
		"to": to,
	})
	if err != nil {
		return err
	}
	return r.parseError(resp)
}

func (r *APIIssueRepository) SetFeedback(ctx context.Context, id string, feedback string, maxIterations int) error {
	resp, err := r.doRequest(ctx, http.MethodPost, "/api/v1/issues/"+id+"/feedback", map[string]any{
		"feedback":       feedback,
		"max_iterations": maxIterations,
	})
	if err != nil {
		return err
	}
	return r.parseError(resp)
}

func (r *APIIssueRepository) StartDeveloping(ctx context.Context, id string, workspacePath string) error {
	resp, err := r.doRequest(ctx, http.MethodPut, "/api/v1/issues/"+id+"/start-developing", map[string]any{
		"workspace_path": workspacePath,
	})
	if err != nil {
		return err
	}
	return r.parseError(resp)
}

func (r *APIIssueRepository) UpdateOutput(ctx context.Context, id string, output string, logs string) error {
	resp, err := r.doRequest(ctx, http.MethodPut, "/api/v1/issues/"+id+"/output", map[string]any{
		"output": output,
		"logs":   logs,
	})
	if err != nil {
		return err
	}
	return r.parseError(resp)
}

func (r *APIIssueRepository) UpdatePR(ctx context.Context, id string, prURL string) error {
	resp, err := r.doRequest(ctx, http.MethodPut, "/api/v1/issues/"+id+"/pr", map[string]any{
		"pr_url": prURL,
	})
	if err != nil {
		return err
	}
	return r.parseError(resp)
}

func (r *APIIssueRepository) UpdateCost(ctx context.Context, id string, costUSD float64, turns int) error {
	resp, err := r.doRequest(ctx, http.MethodPut, "/api/v1/issues/"+id+"/cost", map[string]any{
		"cost_usd": costUSD,
		"turns":    turns,
	})
	if err != nil {
		return err
	}
	return r.parseError(resp)
}

func (r *APIIssueRepository) UpdateAgentInfo(ctx context.Context, id string, agentType string, agentModel string) error {
	resp, err := r.doRequest(ctx, http.MethodPut, "/api/v1/issues/"+id+"/agent-info", map[string]any{
		"agent_type":  agentType,
		"agent_model": agentModel,
	})
	if err != nil {
		return err
	}
	return r.parseError(resp)
}

func (r *APIIssueRepository) Delete(ctx context.Context, id string) error {
	resp, err := r.doRequest(ctx, http.MethodDelete, "/api/v1/issues/"+id, nil)
	if err != nil {
		return err
	}
	return r.parseError(resp)
}
