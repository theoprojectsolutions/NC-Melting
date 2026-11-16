# Melting · Gestão de Não Conformidades — Guia do desenvolvedor

Sistema web multiusuário para registro e tratamento de Não Conformidades (NCs), usado na rede interna (LAN).
Versão do servidor: **2.0** · Data deste pacote: **13/11/2026**.

---

## 1. Visão geral da arquitetura

| Camada | Tecnologia | Arquivo |
|---|---|---|
| Servidor HTTP + API REST | **Python 3.10+ (testado no 3.13)**, só biblioteca padrão (`http.server`, `sqlite3`, `hashlib`…) — **sem dependências externas** | `server.py` |
| Banco de dados | **SQLite** (arquivo único) | `data/melting-nc.db` (criado no 1º start) |
| Front-end | SPA em **JavaScript puro** (sem framework, sem build) | `public/app.js`, `public/index.html`, `public/styles.css` |
| Fonte | Montserrat (Google Fonts, com fallback para Segoe UI) | `index.html` |

- O servidor entrega os arquivos de `public/` e a API em `/api/*` na mesma porta (padrão **8080**, escuta em `0.0.0.0`).
- Não há etapa de build: editou `app.js`/`styles.css`, basta o usuário dar **Ctrl+F5**. Alterou `server.py`, é preciso **reiniciar o servidor**.

## 2. Como rodar

```bash
python server.py                       # porta 8080, dados em ./data
python server.py --port 5519 --data C:\caminho\teste   # instância de teste separada
```

No primeiro acesso (banco vazio) a tela pede para **criar o administrador** (`POST /api/setup`).

Scripts Windows inclusos:

| Arquivo | Função |
|---|---|
| `iniciar-servidor.bat` | Sobe o servidor com janela (útil para ver erros) |
| `iniciar-servidor-oculto.vbs` | Sobe sem janela com `pythonw` (usado na inicialização do Windows) |
| `abrir-sistema.bat` | Liga o servidor se estiver parado e abre o navegador |
| `parar-servidor.bat` | Encerra o processo que escuta na porta 8080 |

Arquivos gerados em `data/` em tempo de execução: `melting-nc.db`, `backups/` (backup diário automático), `servidor.log`, `ENDERECOS.txt` (IPs da rede).

## 3. Estrutura do código

### `server.py`
- **Constantes de negócio** no topo: `PERFIS`, `GESTAO`, `FLOW`, `STATUS_LABEL`, `REQUIRED` (campos obrigatórios), `DEFAULT_CFG`, flag `PLANO_ACAO`.
- **Esquema SQLite**: tabelas `users`, `sessions`, `ncs` (registro em JSON na coluna `data` + `numero`, `status`, `version`, `rev`), `anexos` (BLOB), `kv` (configuração em JSON na chave `cfg`).
- **Segurança**: senhas com **PBKDF2-SHA256** (`hash_pw`/`check_pw`); sessão por cookie HttpOnly (14 dias); toda chamada de API exige o cabeçalho `X-NC: 1` (proteção CSRF).
- **Regras** (o servidor é a fonte da verdade; o front só espelha):
  - `can_view` — visibilidade: admin vê tudo; demais só as NCs em que são responsáveis/registraram/são gestores da área ou precisam autorizar.
  - `can_edit`, `pode_encerrar`, `check_transition` — permissões e fluxo de etapas.
  - `missing_for` — o que falta para sair de cada etapa (contenção → causa raiz).
  - `check_required`, `check_custo_log`, `check_responsavel` — validações de campos.
  - `clean` — sanitiza o registro (Cliente e Título sempre em MAIÚSCULAS).
  - `diff_nc`/`hist` — histórico campo a campo (antes/depois), imutável.
  - `prox_dia_util` — prazo padrão = 1 dia útil após a abertura.
- **Concorrência**: controle otimista por `version` (HTTP 409 se a NC mudou enquanto o usuário editava); sincronização incremental pelo contador `rev`.

### `public/app.js` (seções marcadas com comentários `/* ===== … ===== */`)
- Estado global `S` (usuário, config, NCs, rascunho em edição, filtros).
- Rotas por hash: `#/painel`, `#/ncs`, `#/minhas`, `#/kanban`, `#/nova`, `#/nc/{id}`, `#/usuarios`, `#/config`.
- Polling a cada 15 s (`POLL_MS`, `/api/ncs?since=rev`) para refletir alterações de outros usuários.
- Principais funções: `renderDashboard`, `renderList`, `renderKanban`/`drawBoard`, `drawEditor` (formulário), `renderConfig`, `renderUsers`, `printNC` (relatório A4 em 1 página com `fitPage`).
- Delegação global de eventos: atributos `data-act` (cliques) e `data-f` (campos do formulário, caminho no objeto da NC, ex.: `contencao.descricao`).

### `public/styles.css`
- Tema por variáveis CSS em `:root`; tema claro em `html[data-theme="light"]` (escolha salva em `localStorage['nc-tema']`).
- Estilos de impressão no bloco `@media print` (relatório A4 retrato).

## 4. API REST (JSON)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/status` | Saúde do servidor (público) |
| POST | `/api/setup` | Cria o 1º administrador (só com banco vazio) |
| POST | `/api/login` · `/api/logout` | Sessão |
| GET | `/api/bootstrap` | Usuário logado, config, pessoas e NCs **visíveis** |
| GET | `/api/ncs?since=REV` | Alterações desde `rev` + ids visíveis (sincronização) |
| POST | `/api/ncs` | Cria NC (gera número `PREFIXO-AAAA-NNN`) |
| PUT | `/api/ncs/{id}` | Atualiza/move de etapa (`{nc, version, nota?, force?}`) |
| DELETE | `/api/ncs/{id}` | Exclui (só admin) |
| POST | `/api/ncs/{id}/anexos` | Anexo em data URL (imagem/PDF) |
| GET/DELETE | `/api/anexos/{id}` | Baixa/remove anexo (respeita visibilidade) |
| PUT | `/api/config` | Configurações (só admin) |
| GET/POST/PUT | `/api/users[/{id}]` | Usuários (só admin) |
| POST | `/api/me/senha` | Troca da própria senha |
| GET | `/api/backup` · POST `/api/import` | Backup completo em JSON / importação (só admin) |

## 5. Regras de negócio implementadas

- **Perfis**: Administrador (vê tudo; único que cancela/exclui), Qualidade, Colaborador. Hierarquia por setor em Configurações: **gestor da área** + **equipe** + **custo médio ADM/Operação**.
- **Fluxo**: Aberta → Em análise → Aguardando autorização → Encerrada (+ Cancelada). Aberta exige contenção; Em análise exige causa raiz; **só o gestor da área encerra ou devolve** (admin sempre; Qualidade se o setor não tiver gestor).
- **Obrigatórios**: título, descrição, data, tipo, origem, setor, severidade, responsável (usuário ativo), cliente/fornecedor e "Houve custo logístico?" (valor obrigatório se Sim).
- **Custos**: prejuízo estimado (padrão = custo médio do setor) + custo logístico = prejuízo total; NCs canceladas não entram no custo da não qualidade.
- **Prazo**: 1 dia útil após a abertura (sexta → segunda).
- **Kanban**: encerradas vão para a coluna "Históricos" no dia seguinte ao encerramento (apenas visual; status continua "encerrada").
- **Plano de ação 5W2H e verificação de eficácia** existem no código, mas estão **desligados** pela flag `PLANO_ACAO = False` (em `server.py` **e** em `app.js` — mudar nos dois).

## 6. Dicas para evoluir

- Testes manuais/automatizados: suba uma instância separada com `--port` e `--data` apontando para uma **cópia** do banco.
- **Publicação na internet:** veja `supabase/GUIA-PUBLICACAO.md` (telas na Hostinger, servidor como Edge Function e banco no Supabase). O `server.py` aceita `--proxy` caso um dia rode atrás de um nginx com HTTPS.
- O banco é um arquivo único: para backup basta copiar `data/melting-nc.db` com o servidor parado (ou usar `GET /api/backup`).

## 7. O que NÃO está neste pacote

- **Banco de dados real** (`data/`): contém NCs reais e senhas (hash) dos usuários. Se precisar de dados para testes, peça ao administrador um **backup pelo sistema** (Configurações → Backup) ou uma cópia controlada do banco.
- Vídeos de treinamento (arquivos grandes, não são código).
- Documentação de uso: o POP **POP-QUA-001** está em `docs/`.
