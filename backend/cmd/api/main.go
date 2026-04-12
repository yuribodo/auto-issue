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
)

func main() {
	database, err := db.OpenConnection()
	if err != nil {
		slog.Error("connecting to database", "error", err)
		os.Exit(1)
	}

	db.RunMigration(database)

	issueRepo := repository.NewPGIssueRepository(database)
	configRepo := repository.NewPGConfigRepository(database)

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

	port := cfg.APIPort
	if portStr := os.Getenv("PORT"); portStr != "" {
		if p, err := strconv.Atoi(portStr); err == nil && p > 0 && p < 65536 {
			port = p
		}
	}

	handler := api.NewHandler(issueRepo, configRepo, nil, cfg, nil)
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
		srv.Close()
	}()

	slog.Info("API-only server starting", "addr", addr)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}
