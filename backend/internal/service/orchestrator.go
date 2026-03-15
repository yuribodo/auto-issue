// Package service contains business logic for the auto-issue application.
package service

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"auto-issue/internal/agent"
	"auto-issue/internal/constants"
	"auto-issue/internal/models"
	"auto-issue/internal/repository"
	"auto-issue/internal/workspace"
)

// IssueRequest represents an issue enqueued for processing.
type IssueRequest struct {
	IssueID string
}

// Orchestrator coordinates the issue lifecycle by dispatching work
// to the agent runner and managing phase transitions.
type Orchestrator struct {
	workspace *workspace.Manager
	issues    repository.IssueRepository
	agent     *agent.Runner
	queue     chan IssueRequest
	sem       chan struct{} // concurrency limiter
	wg        sync.WaitGroup
	ctx       context.Context
	cancel    context.CancelFunc
}

// NewOrchestrator creates an Orchestrator wired to the given dependencies.
func NewOrchestrator(ws *workspace.Manager, issues repository.IssueRepository, ag *agent.Runner, maxConcurrency int) *Orchestrator {
	ctx, cancel := context.WithCancel(context.Background())
	return &Orchestrator{
		workspace: ws,
		issues:    issues,
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
	issue, err := o.issues.Get(o.ctx, issueID)
	if err != nil {
		return fmt.Errorf("getting issue: %w", err)
	}

	if issue.Phase != constants.PhaseDeveloping {
		return fmt.Errorf("issue %s is in phase %s, expected developing", issueID, issue.Phase)
	}

	// Step 1: Create or reuse workspace
	wsPath, err := o.workspace.Create(issueID, issue.RepoPath)
	if err != nil {
		o.issues.Transition(o.ctx, issueID, constants.PhaseFailed)
		return fmt.Errorf("creating workspace: %w", err)
	}

	if err := o.issues.StartDeveloping(o.ctx, issueID, wsPath); err != nil {
		return fmt.Errorf("starting development: %w", err)
	}

	// Step 2: Build prompt with issue context + any feedback
	prompt := buildIssuePrompt(issue)

	// Step 3: Run agent in developing mode
	slog.Info("starting development", "issue", issueID, "iteration", issue.Iteration)
	devResult, err := o.agent.Run(o.ctx, wsPath, "developing", prompt)
	if err != nil {
		o.issues.UpdateOutput(o.ctx, issueID, devResult.Output, err.Error())
		o.issues.Transition(o.ctx, issueID, constants.PhaseFailed)
		return fmt.Errorf("development run: %w", err)
	}

	o.issues.UpdateOutput(o.ctx, issueID, devResult.Output, fmt.Sprintf("Development completed in %s", devResult.Duration))

	// Step 4: Transition to code reviewing
	if err := o.issues.Transition(o.ctx, issueID, constants.PhaseCodeReviewing); err != nil {
		return fmt.Errorf("transition to code_reviewing: %w", err)
	}

	// Step 5: Run agent in code review mode
	slog.Info("starting code review", "issue", issueID)
	reviewResult, err := o.agent.Run(o.ctx, wsPath, "code_reviewing", prompt)
	if err != nil {
		o.issues.UpdateOutput(o.ctx, issueID, reviewResult.Output, err.Error())
		o.issues.Transition(o.ctx, issueID, constants.PhaseFailed)
		return fmt.Errorf("code review run: %w", err)
	}

	// Append review output to existing output
	combinedOutput := devResult.Output + "\n\n---\n\n# Code Review\n\n" + reviewResult.Output
	combinedLogs := fmt.Sprintf("Development: %s\nCode Review: %s", devResult.Duration, reviewResult.Duration)
	o.issues.UpdateOutput(o.ctx, issueID, combinedOutput, combinedLogs)

	// Step 6: Move to human review
	if err := o.issues.Transition(o.ctx, issueID, constants.PhaseHumanReview); err != nil {
		return fmt.Errorf("transition to human_review: %w", err)
	}

	slog.Info("issue ready for human review", "issue", issueID)
	return nil
}

func buildIssuePrompt(issue *models.Issue) string {
	prompt := fmt.Sprintf("# Issue: %s\n\n%s", issue.Title, issue.Description)

	if issue.LastFeedback != "" {
		prompt += fmt.Sprintf("\n\n---\n\nPrevious human feedback:\n\"%s\"\n\nPlease make these adjustments and resubmit for review.", issue.LastFeedback)
	}

	return prompt
}
