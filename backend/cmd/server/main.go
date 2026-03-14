// Package main is the entry point for the auto-issue backend server.
// It loads configuration, initializes all components, and starts the HTTP API.
package main

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"auto-issue/internal/agent"
	"auto-issue/internal/api"
	"auto-issue/internal/config"
	"auto-issue/internal/orchestrator"
	"auto-issue/internal/state"
	"auto-issue/internal/workspace"
)

func main() {
	// Load config
	cfg, err := config.Load(config.DefaultConfigPath())
	if err != nil {
		slog.Error("loading config", "error", err)
		os.Exit(1)
	}

	// Initialize state store
	home, err := os.UserHomeDir()
	if err != nil {
		slog.Error("resolving home directory", "error", err)
		os.Exit(1)
	}
	statePath := filepath.Join(home, ".auto-issue", "state.json")
	st, err := state.NewStore(statePath)
	if err != nil {
		slog.Error("initializing state store", "error", err)
		os.Exit(1)
	}

	// Initialize workspace manager
	wsMgr, err := workspace.NewManager(cfg.Workspace.BasePath)
	if err != nil {
		slog.Error("initializing workspace manager", "error", err)
		os.Exit(1)
	}

	// Initialize agent runner and orchestrator
	ag := agent.NewRunner(cfg.Agent)
	orch := orchestrator.New(wsMgr, st, ag, cfg.MaxConcurrency)
	orch.Start()

	// Set up HTTP server
	handler := api.NewHandler(st, orch, cfg)
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
