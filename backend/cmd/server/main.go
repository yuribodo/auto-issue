// Package main is the entry point for the auto-issue backend server.
// Supports two modes controlled by the MODE env var:
//   - "api" (default): API-only server connected to PostgreSQL, no agent execution.
//   - "agent": Local agent runner that talks to the remote API via HTTP,
//     runs orchestrator/agents locally, and exposes the same HTTP endpoints.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"auto-issue/internal/api"
	"auto-issue/internal/config"
	"auto-issue/internal/db"
	"auto-issue/internal/repository"
	"auto-issue/internal/service"
	"auto-issue/internal/workspace"
)

func main() {
	mode := os.Getenv("MODE")
	if mode == "" {
		mode = "api"
	}

	switch mode {
	case "api":
		runAPIMode()
	case "agent":
		runAgentMode()
	default:
		slog.Error("unknown MODE", "mode", mode)
		os.Exit(1)
	}
}

func runAPIMode() {
	slog.Info("starting in API mode (remote database, no agent execution)")

	database, err := db.OpenConnection()
	if err != nil {
		slog.Error("connecting to database", "error", err)
		os.Exit(1)
	}

	db.RunMigration(database)

	issueRepo := repository.NewPGIssueRepository(database)
	configRepo := repository.NewPGConfigRepository(database)

	ctx := newBackgroundCtx()
	cfg, err := configRepo.Load(ctx)
	if err != nil {
		slog.Warn("no config in database, seeding defaults")
		cfg = config.Default()
		if err := configRepo.Save(ctx, cfg); err != nil {
			slog.Error("saving default config to database", "error", err)
			os.Exit(1)
		}
	}

	applyPortOverride(cfg)

	handler := api.NewHandler(issueRepo, configRepo, nil, cfg, nil)
	startServer(handler, cfg.APIPort, nil)
}

func runAgentMode() {
	slog.Info("starting in agent mode (remote API, local agent execution)")

	backendURL := os.Getenv("BACKEND_URL")
	if backendURL == "" {
		slog.Error("BACKEND_URL is required in agent mode")
		os.Exit(1)
	}

	ghToken := os.Getenv("GH_TOKEN")
	if ghToken == "" {
		ghToken = os.Getenv("GITHUB_TOKEN")
	}
	if ghToken != "" {
		slog.Info("GitHub token configured")
	}

	cfg := config.Default()
	applyPortOverride(cfg)

	issueRepo := repository.NewAPIIssueRepository(backendURL, ghToken)

	wsMgr, err := workspace.NewManager(cfg.Workspace.BasePath)
	if err != nil {
		slog.Error("initializing workspace manager", "error", err)
		os.Exit(1)
	}

	broadcaster := api.NewBroadcaster()
	orch := service.NewOrchestrator(wsMgr, issueRepo, cfg.Agent, cfg.Agent.APIKeys, broadcaster, ghToken, cfg.MaxConcurrency)
	orch.Start()

	handler := api.NewHandler(issueRepo, nil, orch, cfg, broadcaster)
	startServer(handler, cfg.APIPort, orch)
}

func startServer(handler *api.Handler, port int, orch *service.Orchestrator) {
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	corsHandler := api.CORSMiddleware(mux)

	addr := fmt.Sprintf(":%d", port)
	srv := &http.Server{Addr: addr, Handler: corsHandler}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-sigCh
		slog.Info("shutting down", "signal", sig)
		if orch != nil {
			orch.Shutdown()
		}
		srv.Close()
	}()

	slog.Info("server starting", "addr", addr)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}

func applyPortOverride(cfg *config.Config) {
	if portStr := os.Getenv("PORT"); portStr != "" {
		if p, err := strconv.Atoi(portStr); err == nil && p > 0 && p < 65536 {
			cfg.APIPort = p
		}
	}
}

func newBackgroundCtx() context.Context {
	return context.Background()
}
