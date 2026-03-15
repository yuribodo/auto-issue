# PRD: Desktop Funcional — GitHub Real + Agent Spawn

## Introduction

O desktop app auto-issue possui toda a UI construída (Dashboard, CreateRun, RunDetail, Analytics, Settings, Onboarding) e a infraestrutura de execução (IPC, git worktrees, CLI spawning, event streaming). Porém, dados críticos ainda são mocks: autenticação GitHub, listagem de repos/issues, notificações e analytics. Este PRD cobre a eliminação de todos os mocks para tornar o app 100% funcional end-to-end: login real no GitHub via OAuth, listagem de repos e issues reais da API, spawn funcional do Claude CLI, e dados derivados de runs reais.

## Goals

- Permitir login real com GitHub via OAuth App (fluxo completo com redirect)
- Listar repositórios e issues reais do usuário via GitHub REST API
- Garantir que o spawn do Claude CLI funcione end-to-end (clone → worktree → agent → PR)
- Computar analytics e notificações a partir de dados reais de runs
- Eliminar todas as dependências de mocks para uso em produção
- Manter a arquitetura local-first (sem backend Go necessário)

## User Stories

### US-001: GitHub OAuth Login
**Description:** As a user, I want to login with my GitHub account so that the app can access my repositories and issues.

**Acceptance Criteria:**
- [ ] Clicar "Login com GitHub" abre o browser no GitHub OAuth authorize
- [ ] Após autorizar, o callback retorna o token via servidor HTTP local (porta 17249)
- [ ] Token é armazenado de forma segura usando `safeStorage` do Electron (com fallback plaintext)
- [ ] Dados do usuário (login, avatar, name) são buscados via `GET /user` e exibidos na UI
- [ ] Parâmetro `state` é gerado e validado para proteção CSRF
- [ ] Logout limpa o token armazenado e redireciona para a tela de login
- [ ] Ao reabrir o app, se há token válido, o login é automático (sem re-autenticação)
- [ ] Se a API retorna 401, redireciona para login

### US-002: GitHub API Client Module
**Description:** As a developer, I need a centralized GitHub API client so that all API calls are consistent and handle errors/rate-limiting uniformly.

**Acceptance Criteria:**
- [ ] Novo módulo `desktop/electron/github.ts` criado
- [ ] Função `getAuthenticatedUser(token)` — `GET /user`
- [ ] Função `getUserRepos(token, page?, perPage?)` — `GET /user/repos?sort=updated&type=all`
- [ ] Função `getRepoIssues(token, owner, repo, page?, perPage?)` — `GET /repos/:owner/:repo/issues?state=open` (filtra PRs)
- [ ] Função `getIssueDetail(token, owner, repo, number)` — `GET /repos/:owner/:repo/issues/:number`
- [ ] Pagination suportada (header `Link`)
- [ ] Rate limiting monitorado (headers `X-RateLimit-*`), erro descritivo quando excedido
- [ ] Usa `fetch()` nativo do Electron (v33+), sem dependências externas
- [ ] Typecheck passa

### US-003: IPC Channels para GitHub API
**Description:** As a developer, I need IPC channels to expose GitHub API data to the renderer process securely.

**Acceptance Criteria:**
- [ ] Novos handlers em `main.ts`: `github:repos`, `github:issues`, `github:issue-detail`
- [ ] Novos canais adicionados ao whitelist em `preload.ts`
- [ ] Wrappers em `ipc.ts`: `getGitHubRepos()`, `getGitHubIssues()`, `getGitHubIssueDetail()`
- [ ] Types `GitHubRepo` e `GitHubIssue` definidos em `shared-types.ts`
- [ ] Token OAuth é passado automaticamente (vem do módulo auth, não do config)
- [ ] Typecheck passa

### US-004: CreateRun com Repos e Issues Reais
**Description:** As a user, I want to select from my real GitHub repositories and their open issues when creating a new run.

**Acceptance Criteria:**
- [ ] Página carrega repos reais do GitHub via `getGitHubRepos()`
- [ ] Campo de busca/filtro para repositórios (usuários podem ter muitos repos)
- [ ] Ao selecionar repo, issues abertas reais são carregadas via `getGitHubIssues()`
- [ ] Issue body real é passado ao `createRun()` (não mais `labels.join()`)
- [ ] Loading states enquanto busca repos e issues
- [ ] Paginação "Load more" para repos e issues
- [ ] Provider padrão é Anthropic, outros marcados como "Coming soon"
- [ ] MOCK_REPOSITORIES, MOCK_ISSUES, MOCK_MODELS removidos desta página
- [ ] Verify in browser using dev-browser skill

### US-005: Auth Guard e Navegação
**Description:** As a user, I should be redirected to login if I'm not authenticated, and to the dashboard if I am.

**Acceptance Criteria:**
- [ ] `App.tsx` checa `getMe()` ao montar — se null, redireciona para `/`
- [ ] AuthContext provê `user` e `isAuthenticated` para toda a app
- [ ] Rotas protegidas redirecionam para login se não autenticado
- [ ] Login.tsx agora usa fluxo OAuth real
- [ ] Onboarding é exibido apenas no primeiro login (sem config anterior)
- [ ] Typecheck passa

### US-006: Claude CLI Spawn Funcional
**Description:** As a user, I want the Claude agent to actually fix the issue, commit changes, and create a PR.

**Acceptance Criteria:**
- [ ] Comando alterado de `claude --print` para `claude -p` com flags apropriados para modo agêntico
- [ ] Prompt melhorado com instruções detalhadas (analisar issue, fazer changes, commitar, criar PR)
- [ ] `GH_TOKEN` e `GITHUB_TOKEN` injetados no env do processo para que `gh pr create` funcione
- [ ] Token OAuth usado para git operations (substituir `config.github_token`)
- [ ] Verificação de que `claude` CLI está instalado antes de spawnar (com erro claro se não)
- [ ] PR detection funciona quando o agente cria PR via `gh`
- [ ] Typecheck passa

### US-007: Settings com Repos Reais
**Description:** As a user, I want the Settings page to show my real GitHub repos and remove mock data dependencies.

**Acceptance Criteria:**
- [ ] Tab Repos carrega repositórios reais via `getGitHubRepos()`
- [ ] Repos monitorados salvos como `monitored_repos: string[]` no config
- [ ] Campo de GitHub token manual removido (token agora vem do OAuth)
- [ ] Lista de models definida como constante estática (não mock)
- [ ] MOCK_REPOSITORIES removido desta página
- [ ] Verify in browser using dev-browser skill

### US-008: Analytics com Dados Reais
**Description:** As a user, I want Analytics to show real statistics computed from actual runs.

**Acceptance Criteria:**
- [ ] Stats computados a partir de `getRuns()` reais
- [ ] Daily stats: agrupa runs por data
- [ ] Provider stats: agrupa por provider (count, custo médio, tempo médio)
- [ ] Repo stats: agrupa por repo (count, success rate)
- [ ] Success rate calculada de runs reais
- [ ] MOCK_DAILY_STATS, MOCK_PROVIDER_STATS, MOCK_REPO_STATS removidos
- [ ] Dados vazios mostram empty state (não quebra com 0 runs)
- [ ] Typecheck passa

### US-009: Notificações Derivadas de Runs
**Description:** As a user, I want real notifications based on actual run events instead of mock data.

**Acceptance Criteria:**
- [ ] Hook `useNotifications()` escuta eventos `run:event` via IPC
- [ ] Notificação gerada quando run muda para `awaiting_approval`
- [ ] Notificação gerada quando run muda para `failed`
- [ ] Notificação gerada quando PR URL é detectada
- [ ] Estado read/unread persistido em localStorage
- [ ] MOCK_NOTIFICATIONS removido
- [ ] Typecheck passa

### US-010: Limpeza de Mocks
**Description:** As a developer, I want all mock dependencies removed from production code.

**Acceptance Criteria:**
- [ ] `mocks.ts` deletado ou mantido apenas para uso em testes/dev
- [ ] Nenhuma página importa de `mocks.ts` em produção
- [ ] Todas as referências a MOCK_* removidas dos componentes
- [ ] App funciona completamente com dados reais
- [ ] Typecheck e build passam sem erros

## Functional Requirements

- FR-1: Implementar fluxo OAuth completo com servidor HTTP local na porta 17249
- FR-2: Armazenar token OAuth com `safeStorage` do Electron (criptografado no keychain do OS)
- FR-3: Criar módulo `github.ts` com funções para user, repos, issues (paginação + rate limiting)
- FR-4: Adicionar 3 novos canais IPC: `github:repos`, `github:issues`, `github:issue-detail`
- FR-5: CreateRun busca repos/issues reais com busca, filtro e paginação
- FR-6: Claude CLI spawna em modo agêntico (`-p`) com prompt estruturado
- FR-7: Injetar `GH_TOKEN`/`GITHUB_TOKEN` no env do processo agente
- FR-8: Analytics computa todas as métricas a partir de runs reais
- FR-9: Notificações são derivadas de eventos de run em tempo real
- FR-10: Auth guard protege todas as rotas (redireciona para login se não autenticado)
- FR-11: Verificar disponibilidade do `claude` CLI antes de spawnar

## Non-Goals

- Backend Go (HTTP API server) — não necessário para MVP local
- Suporte funcional para Codex/Gemini — ficam como placeholder
- Auto-monitoring de issues (webhook ou polling automático)
- GitHub App (vs OAuth App) — OAuth App é suficiente
- Multi-user ou team features
- Database persistence (JSON files são suficientes para MVP)
- Push notifications nativas do OS
- Feedback loop (re-run com feedback do reviewer)

## Technical Considerations

- **Electron 33.2.0**: Suporta `fetch()` nativo no main process, `safeStorage` API
- **Context Isolation**: Todas as chamadas GitHub devem ir pelo main process via IPC (nunca direto do renderer)
- **Token Security**: `safeStorage.encryptString()` usa keychain do OS; fallback para plaintext em ambientes sem keychain (Linux sem gnome-keyring)
- **GitHub OAuth App**: Precisa ser criada em github.com/settings/developers com callback `http://localhost:17249/oauth/callback`
- **Client Secret no Main Process**: Seguro pois nunca é exposto ao renderer
- **Rate Limiting**: Autenticado = 5000 req/hr (suficiente para uso individual)
- **Claude CLI**: Requer `claude` instalado globalmente; usar flag `-p` para modo não-interativo com tools

## Success Metrics

- Usuário consegue fazer login, selecionar repo real, selecionar issue real, e spawnar agente em menos de 2 minutos
- Agente Claude cria PR com sucesso para issues simples
- Analytics refletem dados reais de runs executados
- Zero imports de mocks.ts em código de produção
- App inicia e funciona sem erros quando há token válido

## Open Questions

- Qual `client_id` e `client_secret` usar para o OAuth App? (precisa criar no GitHub)
- O Claude CLI do usuário suporta `-p` com tool execution? (depende da versão instalada)
- Devemos adicionar `safeStorage` fallback warning na UI ou apenas no console?
- Considerar porta alternativa se 17249 estiver em uso?
