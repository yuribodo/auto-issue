// Package main is the entry point for the auto-issue backend server.
// It connects to PostgreSQL, runs migrations, initializes all components,
// and starts the HTTP API.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"auto-issue/internal/agent"
	"auto-issue/internal/api"
	"auto-issue/internal/config"
	"auto-issue/internal/db"
	"auto-issue/internal/repository"
	"auto-issue/internal/service"
	"auto-issue/internal/workspace"
)

func main() {
	// Connect to PostgreSQL
	database, err := db.OpenConnection()
	if err != nil {
		slog.Error("connecting to database", "error", err)
		os.Exit(1)
	}

	// Run migrations
	db.RunMigration(database)

	// Initialize repositories
	issueRepo := repository.NewPGIssueRepository(database)
	configRepo := repository.NewPGConfigRepository(database)

	// Load config from database (seed defaults on first run)
	ctx := context.Background()
	cfg, err := configRepo.Load(ctx)
	if err != nil {
		slog.Warn("no config in database, seeding defaults")
		cfg = config.Default()
		if err := configRepo.Save(ctx, cfg); err != nil {
			slog.Error("saving default config to database", "error", err)
			os.Exit(1)
		}
	}

	// Initialize workspace manager
	wsMgr, err := workspace.NewManager(cfg.Workspace.BasePath)
	if err != nil {
		slog.Error("initializing workspace manager", "error", err)
		os.Exit(1)
	}

	// Initialize agent runner and orchestrator
	ag := agent.NewRunner(cfg.Agent)
	orch := service.NewOrchestrator(wsMgr, issueRepo, ag, cfg.MaxConcurrency)
	orch.Start()

	// Set up HTTP server
	handler := api.NewHandler(issueRepo, configRepo, orch, cfg)
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	addr := fmt.Sprintf(":%d", cfg.APIPort)
	srv := &http.Server{Addr: addr, Handler: mux}

	// Graceful shutdown on SIGINT/SIGTERM
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		sig := <-sigCh
		slog.Info("shutting down", "signal", sig)
		orch.Shutdown()
		srv.Close()
	}()

	slog.Info("server starting", "addr", addr)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}
