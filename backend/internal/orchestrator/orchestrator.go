package orchestrator

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"auto-issue/internal/agent"
	"auto-issue/internal/state"
	"auto-issue/internal/workspace"
)

type IssueRequest struct {
	IssueID string
}

type Orchestrator struct {
	workspace *workspace.Manager
	state     *state.Store
	agent     *agent.Runner
	queue     chan IssueRequest
	sem       chan struct{} // concurrency limiter
	wg        sync.WaitGroup
	ctx       context.Context
	cancel    context.CancelFunc
}

func New(ws *workspace.Manager, st *state.Store, ag *agent.Runner, maxConcurrency int) *Orchestrator {
	ctx, cancel := context.WithCancel(context.Background())
	return &Orchestrator{
		workspace: ws,
		state:     st,
		agent:     ag,
		queue:     make(chan IssueRequest, 100),
		sem:       make(chan struct{}, maxConcurrency),
		ctx:       ctx,
		cancel:    cancel,
	}
}

// Start begins consuming from the work queue.
func (o *Orchestrator) Start() {
	go o.consumeLoop()
}

// Enqueue adds an issue to the work queue.
func (o *Orchestrator) Enqueue(issueID string) {
	o.queue <- IssueRequest{IssueID: issueID}
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

			if err := o.processIssue(r.IssueID); err != nil {
				slog.Error("processing issue failed", "issue", r.IssueID, "error", err)
			}
		}(req)
	}
}

func (o *Orchestrator) processIssue(issueID string) error {
	issue, err := o.state.Get(issueID)
	if err != nil {
		return fmt.Errorf("getting issue: %w", err)
	}

	if issue.Phase != state.PhaseDeveloping {
		return fmt.Errorf("issue %s is in phase %s, expected developing", issueID, issue.Phase)
	}

	// Step 1: Create or reuse workspace
	wsPath, err := o.workspace.Create(issueID, issue.RepoPath)
	if err != nil {
		o.state.Transition(issueID, state.PhaseFailed)
		return fmt.Errorf("creating workspace: %w", err)
	}

	if err := o.state.StartDeveloping(issueID, wsPath); err != nil {
		return fmt.Errorf("starting development: %w", err)
	}

	// Step 2: Build prompt with issue context + any feedback
	prompt := o.buildIssuePrompt(issue)

	// Step 3: Run agent in developing mode
	slog.Info("starting development", "issue", issueID, "iteration", issue.Iteration)
	devResult, err := o.agent.Run(o.ctx, wsPath, "developing", prompt)
	if err != nil {
		o.state.UpdateOutput(issueID, devResult.Output, err.Error())
		o.state.Transition(issueID, state.PhaseFailed)
		return fmt.Errorf("development run: %w", err)
	}

	o.state.UpdateOutput(issueID, devResult.Output, fmt.Sprintf("Development completed in %s", devResult.Duration))

	// Step 4: Transition to code reviewing
	if err := o.state.Transition(issueID, state.PhaseCodeReviewing); err != nil {
		return fmt.Errorf("transition to code_reviewing: %w", err)
	}

	// Step 5: Run agent in code review mode
	slog.Info("starting code review", "issue", issueID)
	reviewResult, err := o.agent.Run(o.ctx, wsPath, "code_reviewing", prompt)
	if err != nil {
		o.state.UpdateOutput(issueID, reviewResult.Output, err.Error())
		o.state.Transition(issueID, state.PhaseFailed)
		return fmt.Errorf("code review run: %w", err)
	}

	// Append review output to existing output
	combinedOutput := devResult.Output + "\n\n---\n\n# Code Review\n\n" + reviewResult.Output
	combinedLogs := fmt.Sprintf("Development: %s\nCode Review: %s", devResult.Duration, reviewResult.Duration)
	o.state.UpdateOutput(issueID, combinedOutput, combinedLogs)

	// Step 6: Move to human review
	if err := o.state.Transition(issueID, state.PhaseHumanReview); err != nil {
		return fmt.Errorf("transition to human_review: %w", err)
	}

	slog.Info("issue ready for human review", "issue", issueID)
	return nil
}

func (o *Orchestrator) buildIssuePrompt(issue *state.IssueState) string {
	prompt := fmt.Sprintf("# Issue: %s\n\n%s", issue.Title, issue.Description)

	if issue.LastFeedback != "" {
		prompt += fmt.Sprintf("\n\n---\n\nPrevious human feedback:\n\"%s\"\n\nPlease make these adjustments and resubmit for review.", issue.LastFeedback)
	}

	return prompt
}
