// Package service contains business logic for the auto-issue application.
package service

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"auto-issue/internal/agent"
	"auto-issue/internal/config"
	"auto-issue/internal/constants"
	"auto-issue/internal/models"
	"auto-issue/internal/repository"
	"auto-issue/internal/workspace"
)

// EventBroadcaster defines the interface for broadcasting agent events.
// Defined here to avoid import cycles with the api package.
type EventBroadcaster interface {
	Broadcast(issueID string, event agent.AgentEvent)
}

// IssueRequest represents an issue enqueued for processing.
type IssueRequest struct {
	IssueID string
	GHToken string // per-request GitHub token from the user's OAuth session
}

// Orchestrator coordinates the issue lifecycle by dispatching work
// to the agent runner and managing phase transitions.
type Orchestrator struct {
	workspace   *workspace.Manager
	issues      repository.IssueRepository
	defaultCfg  config.AgentConfig
	apiKeys     map[string]string
	broadcaster EventBroadcaster
	ghToken     string
	queue       chan IssueRequest
	sem         chan struct{} // concurrency limiter
	wg          sync.WaitGroup
	ctx         context.Context
	cancel      context.CancelFunc
	mu          sync.Mutex
	cancels     map[string]context.CancelFunc // per-issue cancel functions
}

// NewOrchestrator creates an Orchestrator wired to the given dependencies.
func NewOrchestrator(ws *workspace.Manager, issues repository.IssueRepository, defaultCfg config.AgentConfig, apiKeys map[string]string, broadcaster EventBroadcaster, ghToken string, maxConcurrency int) *Orchestrator {
	ctx, cancel := context.WithCancel(context.Background())
	return &Orchestrator{
		workspace:   ws,
		issues:      issues,
		defaultCfg:  defaultCfg,
		apiKeys:     apiKeys,
		broadcaster: broadcaster,
		ghToken:     ghToken,
		queue:       make(chan IssueRequest, 100),
		sem:         make(chan struct{}, maxConcurrency),
		ctx:         ctx,
		cancel:      cancel,
		cancels:     make(map[string]context.CancelFunc),
	}
}

// Start begins consuming from the work queue.
func (o *Orchestrator) Start() {
	go o.consumeLoop()
}

// Enqueue adds an issue to the work queue.
// ghToken is the user's GitHub OAuth token; if empty, falls back to the server-wide token.
func (o *Orchestrator) Enqueue(issueID string, ghToken string) {
	o.queue <- IssueRequest{IssueID: issueID, GHToken: ghToken}
}

// CancelIssue cancels a running issue's agent process and transitions it to failed.
func (o *Orchestrator) CancelIssue(issueID string) bool {
	o.mu.Lock()
	cancelFn, ok := o.cancels[issueID]
	o.mu.Unlock()
	if ok {
		cancelFn()
		return true
	}
	return false
}

// Shutdown stops accepting new work and waits for active workers to finish.
func (o *Orchestrator) Shutdown() {
	o.cancel()
	close(o.queue)
	o.wg.Wait()
}

func (o *Orchestrator) consumeLoop() {
	for req := range o.queue {
		if o.ctx.Err() != nil {
			return
		}

		o.sem <- struct{}{} // acquire semaphore
		o.wg.Add(1)

		go func(r IssueRequest) {
			defer o.wg.Done()
			defer func() { <-o.sem }() // release semaphore

			if err := o.processIssue(r.IssueID, r.GHToken); err != nil {
				slog.Error("processing issue failed", "issue", r.IssueID, "error", err)
			}
		}(req)
	}
}

func (o *Orchestrator) broadcastEvent(issueID string, eventType agent.AgentEventType, prefix, content string) {
	if o.broadcaster != nil {
		o.broadcaster.Broadcast(issueID, agent.AgentEvent{
			Type:      eventType,
			Timestamp: time.Now(),
			Prefix:    prefix,
			Content:   content,
		})
	}
}

func (o *Orchestrator) processIssue(issueID string, ghToken string) error {
	// Fall back to server-wide token if no per-request token provided
	if ghToken == "" {
		ghToken = o.ghToken
	}

	// Create per-issue context for cancellation
	issueCtx, issueCancel := context.WithCancel(o.ctx)
	defer issueCancel()

	o.mu.Lock()
	o.cancels[issueID] = issueCancel
	o.mu.Unlock()
	defer func() {
		o.mu.Lock()
		delete(o.cancels, issueID)
		o.mu.Unlock()
	}()

	issue, err := o.issues.Get(issueCtx, issueID)
	if err != nil {
		return fmt.Errorf("getting issue: %w", err)
	}

	if issue.Phase != constants.PhaseDeveloping {
		return fmt.Errorf("issue %s is in phase %s, expected developing", issueID, issue.Phase)
	}

	// Resolve agent type and model (per-issue overrides global default)
	agentType := issue.AgentType
	if agentType == "" {
		agentType = o.defaultCfg.Type
	}
	agentModel := issue.AgentModel
	if agentModel == "" {
		agentModel = o.defaultCfg.Model
	}

	provider, err := agent.NewProvider(agent.ProviderConfig{
		Type:    agentType,
		Model:   agentModel,
		Timeout: o.defaultCfg.Timeout,
		Prompt:  o.defaultCfg.Prompt,
		GHToken: ghToken,
		APIKeys: o.apiKeys,
	})
	if err != nil {
		o.broadcastEvent(issueID, agent.EventError, "ERR", fmt.Sprintf("Provider error: %s", err))
		o.issues.Transition(context.Background(), issueID, constants.PhaseFailed)
		return fmt.Errorf("creating provider: %w", err)
	}

	o.broadcastEvent(issueID, agent.EventStatus, "INFO", "Preparing workspace...")

	// Step 1: Create or reuse workspace
	var wsPath string
	if issue.GithubRepo != "" {
		// Remote GitHub repo — use worktree from cached clone
		wsPath, err = o.workspace.CreateFromRemote(issueID, issue.GithubRepo, ghToken)
	} else {
		// Local repo — use worktree from local path
		wsPath, err = o.workspace.Create(issueID, issue.RepoPath)
	}
	if err != nil {
		o.broadcastEvent(issueID, agent.EventError, "ERR", fmt.Sprintf("Workspace setup failed: %s", err))
		o.issues.Transition(context.Background(), issueID, constants.PhaseFailed)
		return fmt.Errorf("creating workspace: %w", err)
	}

	o.broadcastEvent(issueID, agent.EventStatus, "INFO", fmt.Sprintf("Workspace ready: %s", wsPath))

	if err := o.issues.StartDeveloping(issueCtx, issueID, wsPath); err != nil {
		return fmt.Errorf("starting development: %w", err)
	}

	// Step 2: Build prompt with issue context + any feedback
	prompt := buildIssuePrompt(issue)

	// Step 3: Run agent in developing mode with streaming
	o.broadcastEvent(issueID, agent.EventStatus, "PHASE", "developing")
	slog.Info("starting development", "issue", issueID, "iteration", issue.Iteration)

	devResult, err := o.runAgentStreaming(issueCtx, issueID, provider, wsPath, "developing", prompt)
	if err != nil {
		// Use background context for DB writes since issueCtx may be cancelled
		bgCtx := context.Background()
		o.issues.UpdateOutput(bgCtx, issueID, devResult.Output, err.Error())
		o.issues.Transition(bgCtx, issueID, constants.PhaseFailed)
		if issueCtx.Err() != nil {
			o.broadcastEvent(issueID, agent.EventStatus, "INFO", "Issue cancelled by user")
			return fmt.Errorf("issue cancelled")
		}
		return fmt.Errorf("development run: %w", err)
	}

	o.issues.UpdateOutput(issueCtx, issueID, devResult.Output, fmt.Sprintf("Development completed in %s", devResult.Duration))

	// Save PR URL and cost if detected during development
	if devResult.PRURL != "" {
		o.issues.UpdatePR(issueCtx, issueID, devResult.PRURL)
	}
	if devResult.CostUSD > 0 || devResult.Turns > 0 {
		o.issues.UpdateCost(issueCtx, issueID, devResult.CostUSD, devResult.Turns)
	}

	// Step 4: Transition to code reviewing
	o.broadcastEvent(issueID, agent.EventStatus, "PHASE", "code_reviewing")
	if err := o.issues.Transition(issueCtx, issueID, constants.PhaseCodeReviewing); err != nil {
		return fmt.Errorf("transition to code_reviewing: %w", err)
	}

	// Step 5: Run agent in code review mode with streaming
	slog.Info("starting code review", "issue", issueID)
	reviewResult, err := o.runAgentStreaming(issueCtx, issueID, provider, wsPath, "code_reviewing", prompt)
	if err != nil {
		bgCtx := context.Background()
		o.issues.UpdateOutput(bgCtx, issueID, reviewResult.Output, err.Error())
		o.issues.Transition(bgCtx, issueID, constants.PhaseFailed)
		if issueCtx.Err() != nil {
			o.broadcastEvent(issueID, agent.EventStatus, "INFO", "Issue cancelled by user")
			return fmt.Errorf("issue cancelled")
		}
		return fmt.Errorf("code review run: %w", err)
	}

	// Append review output to existing output
	combinedOutput := devResult.Output + "\n\n---\n\n# Code Review\n\n" + reviewResult.Output
	combinedLogs := fmt.Sprintf("Development: %s\nCode Review: %s", devResult.Duration, reviewResult.Duration)
	o.issues.UpdateOutput(issueCtx, issueID, combinedOutput, combinedLogs)

	// Update total cost (dev + review)
	totalCost := devResult.CostUSD + reviewResult.CostUSD
	totalTurns := devResult.Turns + reviewResult.Turns
	o.issues.UpdateCost(issueCtx, issueID, totalCost, totalTurns)

	// Save PR URL if detected during review
	if reviewResult.PRURL != "" && devResult.PRURL == "" {
		o.issues.UpdatePR(issueCtx, issueID, reviewResult.PRURL)
	}

	// Step 6: Move to human review
	o.broadcastEvent(issueID, agent.EventStatus, "PHASE", "human_review")
	if err := o.issues.Transition(issueCtx, issueID, constants.PhaseHumanReview); err != nil {
		return fmt.Errorf("transition to human_review: %w", err)
	}

	slog.Info("issue ready for human review", "issue", issueID,
		"cost", fmt.Sprintf("$%.2f", totalCost),
		"turns", totalTurns,
		"pr", devResult.PRURL)
	return nil
}

// runAgentStreaming runs the agent and broadcasts all events to SSE subscribers.
func (o *Orchestrator) runAgentStreaming(ctx context.Context, issueID string, provider agent.ProviderRunner, wsPath string, mode string, prompt string) (agent.RunResult, error) {
	events, resultCh, err := provider.RunStreaming(ctx, wsPath, mode, prompt)
	if err != nil {
		return agent.RunResult{}, err
	}

	// Forward all events to broadcaster
	for evt := range events {
		if o.broadcaster != nil {
			o.broadcaster.Broadcast(issueID, evt)
		}
	}

	result := <-resultCh
	if result.ExitCode != 0 && result.Output == "" {
		return result, fmt.Errorf("agent exited with code %d", result.ExitCode)
	}

	return result, nil
}

func buildIssuePrompt(issue *models.Issue) string {
	// Use GitHub-aware prompt when we have GitHub repo info
	if issue.GithubRepo != "" && issue.IssueNumber > 0 {
		prompt := fmt.Sprintf(`You are working on the repository %s. Fix GitHub issue #%d.

Issue title: %s

Issue description:
%s

Instructions:
1. Analyze the issue and understand what needs to be fixed
2. Make the necessary code changes
3. Run any existing tests to verify your changes
4. Create a git commit with a descriptive message referencing the issue
5. Push the branch and create a pull request that closes #%d

Use `+"`"+`gh pr create --title "Fix #%d: %s" --body "Closes #%d"`+"`"+` to create the PR.`,
			issue.GithubRepo, issue.IssueNumber,
			issue.Title,
			issue.Description,
			issue.IssueNumber,
			issue.IssueNumber, issue.Title, issue.IssueNumber)

		if issue.LastFeedback != "" {
			prompt += fmt.Sprintf("\n\n---\n\nPrevious human feedback:\n\"%s\"\n\nPlease make these adjustments and resubmit for review.", issue.LastFeedback)
		}

		return prompt
	}

	// Fallback: original simple prompt for local repos
	prompt := fmt.Sprintf("# Issue: %s\n\n%s", issue.Title, issue.Description)

	if issue.LastFeedback != "" {
		prompt += fmt.Sprintf("\n\n---\n\nPrevious human feedback:\n\"%s\"\n\nPlease make these adjustments and resubmit for review.", issue.LastFeedback)
	}

	return prompt
}
