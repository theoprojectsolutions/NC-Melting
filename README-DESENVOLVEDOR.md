# Melting · Gestão de Não Conformidades — Guia do desenvolvedor

Sistema web multiusuário para registro e tratamento de Não Conformidades (NCs), usado na rede interna (LAN).
Versão do servidor: **2.0** · Data deste pacote: **24/11/2026**.

---

## Novidades de 24/11/2026

- **Prazo padrão = 3 dias corridos após a emissão**: `PRAZO_DIAS`/`prazo_padrao()` em `server.py` e `PRAZO_DIAS`/`prazoPadrao()` em `app.js` (substituem `prox_dia_util`/`proxDiaUtil`, que usavam 1 dia útil).
- **Responsável pelo tratamento** começa vazio ("Selecione o usuário…"); `applySetorResp` não preenche mais o gestor — só reordena a lista. Continua obrigatório (`check_responsavel`).
- **Data da justificativa (seção 3)** é definida pelo servidor em `data_justificativa(d, old)`: hoje quando o texto é escrito/alterado, mantém a data quando o texto não muda, vazia sem texto. No front o campo é somente leitura e mostra a data na hora em que o texto é digitado.

## Novidades de 18/11/2026 (só front-end)

- **Usuários online**: o topo mostra só a quantidade; a lista completa (`#online-pop`) abre no hover de `.online-box` (CSS) ou no clique (`data-act="online-toggle"`, para toque).
- **Painel → Por origem**: quadro novo (`.dash-origem`) com total do período, quantidade e % por origem (inclui as origens configuradas sem NC) e linha de total.
- **Padrão dos rankings** (origem, setor, responsável, top 20 clientes, custo por setor): helper `qp(v, total, cor, valor?)` em `renderDashboard` gera "quantidade/valor + selo de %"; estilos na classe `.qp` (quadros estreitos usam layout em duas linhas).
- **Configurações → Setor responsável pela NC**: cartão de chips igual ao de Origens, editando `cfg.setores`. Excluir setor pede confirmação; o servidor já remove gestor/equipe/custo do setor excluído (`r_cfg`).

## Novidades desde o pacote de 13/11/2026

- **Usuários online** no canto superior direito (avatares com o nome completo ao passar o mouse). Mantido em memória no servidor (`ONLINE`, janela de 90 s), enviado no bootstrap e no polling.
- **Notificações**: tabela `notificacoes`; ao abrir uma NC (fora de rascunho) o responsável é avisado, e a cada mudança de etapa quem precisa agir é avisado (`notificar`/`notificar_etapa`). No front: pop-up na tela e sino com lidas/não lidas (`POST /api/notificacoes/lidas`).
- **Logs de acesso / auditoria**: tabela `auditoria` + helper `audit()`. Grava login (ok, senha incorreta, usuário inexistente/desativado), logout, criação/alteração/exclusão de NC, anexos, configurações, usuários, troca de senha, backup e importação. Aba **Logs de acesso** em Usuários (admin e gestor), com filtros e exportação CSV (`GET /api/auditoria`).
- **Perfil Gestor** (abaixo do admin): vê tudo, só consulta.
- **Rascunho**: a NC pode ser salva como rascunho (status `aberta`, visível/editável só por quem abriu + admin/gestor/qualidade). Ao enviar, vai para *Em análise*.
- **Etapa Qualidade** depois da autorização: o gestor da área autoriza; a Qualidade registra a Ação da Qualidade e encerra (`ENCERRA = admin, gestor, qualidade`).
- **Históricos**: nova rota `#/historicos` no menu lateral (encerradas a partir do dia seguinte + canceladas). Saiu da coluna do Kanban.
- **Kanban**: seta de ordenação por data em cada coluna (`localStorage['nc-ksort']`); o cartão mostra a data de abertura e o gestor da área.
- **Seção 3** do formulário: ficou só a justificativa do responsável + data (saíram "Disposição do produto" e "Responsável"; o cartão "Disposições do produto" saiu das Configurações).
- Menu lateral sem "Registrar NC" (o botão **+ Nova NC** fica ao lado do título da página).

## 1. Visão geral da arquitetura

| Camada | Tecnologia | Arquivo |
|---|---|---|
| Servidor HTTP + API REST | **Python 3.10+ (testado no 3.13)**, só biblioteca padrão (`http.server`, `sqlite3`, `hashlib`…) — **sem dependências externas** | `server.py` |
| Banco de dados | **SQLite** (arquivo único) | `data/melting-nc.db` (criado no 1º start) |
| Front-end | SPA em **JavaScript puro** (sem framework, sem build) | `public/app.js`, `public/index.html`, `public/styles.css` |
| Fonte | Montserrat (Google Fonts, com fallback para Segoe UI) | `index.html` |

- O servidor entrega os arquivos de `public/` e a API em `/api/*` na mesma porta (padrão **8080**, escuta em `0.0.0.0`).
- Não há etapa de build: editou `app.js`/`styles.css`, basta o usuário dar **Ctrl+F5**. Alterou `server.py`, é preciso **reiniciar o servidor**.
- As tabelas novas (`auditoria`, `notificacoes`) são criadas automaticamente no start (`CREATE TABLE IF NOT EXISTS`) — não há migração manual.

## 2. Como rodar

```bash
python server.py                       # porta 8080, dados em ./data
python server.py --port 5519 --data C:\caminho\teste   # instância de teste separada
```

No primeiro acesso (banco vazio) a tela pede para **criar o administrador** (`POST /api/setup`).

| Arquivo | Função |
|---|---|
| `iniciar-servidor.bat` | Sobe o servidor com janela (útil para ver erros) |
| `iniciar-servidor-oculto.vbs` | Sobe sem janela com `pythonw` (usado na inicialização do Windows) |
| `abrir-sistema.bat` | Liga o servidor se estiver parado e abre o navegador |
| `parar-servidor.bat` | Encerra o processo que escuta na porta 8080 |

Arquivos gerados em `data/` em tempo de execução: `melting-nc.db`, `backups/` (backup diário automático), `servidor.log`, `ENDERECOS.txt` (IPs da rede).

## 3. Estrutura do código

### `server.py`
- **Constantes de negócio** no topo: `PERFIS`, `VE_TUDO` (admin, gestor), `VE_TODAS_NCS` (admin, gestor, qualidade), `ENCERRA`, `FLOW`, `STATUS_LABEL`, `REQUIRED`, `DEFAULT_CFG`, flag `PLANO_ACAO`.
- **Esquema SQLite**: `users`, `sessions`, `ncs` (registro em JSON na coluna `data` + `numero`, `status`, `version`, `rev`), `anexos` (BLOB), `kv` (config em JSON na chave `cfg`), `auditoria`, `notificacoes`.
- **Segurança**: senhas com **PBKDF2-SHA256** (`hash_pw`/`check_pw`); sessão por cookie HttpOnly (14 dias); toda chamada de API exige o cabeçalho `X-NC: 1` (proteção CSRF).
- **Regras** (o servidor é a fonte da verdade; o front só espelha):
  - `can_view` — visibilidade (rascunho só para quem abriu + perfis de `VE_TODAS_NCS`).
  - `can_edit`, `pode_encerrar`, `check_transition` — permissões e fluxo (sair de *Aguardando autorização* exige o gestor da área; encerrar exige perfil em `ENCERRA`).
  - `missing_for` — o que falta para sair de cada etapa (justificativa + causa raiz em *Em análise*; ação da Qualidade em *Qualidade*).
  - `check_rascunho`, `check_required`, `check_custo_log`, `check_responsavel` — validações.
  - `clean`, `diff_nc`/`hist` — como antes; `prazo_padrao` (prazo = emissão + 3 dias); `data_justificativa` (data da seção 3).
  - `audit`, `resumo_alteracoes` — trilha de auditoria; `notificar`, `notificar_etapa`, `notif_resumo` — notificações; `marca_online`, `online_list` — presença.
- **Concorrência**: controle otimista por `version` (HTTP 409); sincronização incremental pelo contador `rev`.

### `public/app.js`
- Estado global `S` (usuário, config, NCs, rascunho em edição, filtros, notificações, online).
- Rotas por hash: `#/painel`, `#/ncs`, `#/minhas`, `#/kanban`, `#/historicos`, `#/nova`, `#/nc/{id}`, `#/usuarios`, `#/config`.
- Polling a cada 15 s (`/api/ncs?since=rev`), que também traz `online` e `notif`.
- Principais funções: `renderDashboard`, `renderList`, `renderKanban`/`drawBoard` (`kSortGet`/`kSortToggle`), `renderHistoricos`/`drawHistoricos`, `drawEditor`, `renderConfig`, `renderUsers`/`renderLogs`/`exportLogsCSV`, `renderOnline`, `renderNotif`/`notifPopup`, `printNC`.
- Delegação global de eventos: `data-act` (cliques), `data-f` (formulário), `data-kf` (filtros do Kanban), `data-hf` (filtros dos Históricos), `data-logf` (filtros dos logs).
- `localStorage`: `nc-tema`, `nc-kf`, `nc-ksort`, `nc-notif-visto-<uid>`.

### `public/styles.css`
- Tema por variáveis CSS em `:root`; tema claro em `html[data-theme="light"]`.
- Estilos de impressão no bloco `@media print` (relatório A4 retrato).

## 4. API REST (JSON)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/status` | Saúde do servidor (público) |
| POST | `/api/setup` | Cria o 1º administrador (só com banco vazio) |
| POST | `/api/login` · `/api/logout` | Sessão (gravadas na auditoria) |
| GET | `/api/bootstrap` | Usuário, config, pessoas, NCs **visíveis**, online e notificações |
| GET | `/api/ncs?since=REV` | Alterações desde `rev` + ids visíveis + online + notificações |
| POST | `/api/ncs` | Cria NC (`{nc, rascunho?}`; gera número `PREFIXO-AAAA-NNN`) |
| PUT | `/api/ncs/{id}` | Atualiza/move de etapa (`{nc, version, nota?, force?}`) |
| DELETE | `/api/ncs/{id}` | Exclui (só admin) |
| POST | `/api/ncs/{id}/anexos` | Anexo em data URL (imagem/PDF) |
| GET/DELETE | `/api/anexos/{id}` | Baixa/remove anexo (respeita visibilidade) |
| POST | `/api/notificacoes/lidas` | Marca notificações como lidas |
| PUT | `/api/config` | Configurações (só admin) |
| GET/POST/PUT/DELETE | `/api/users[/{id}]` | Usuários (escrita só admin; leitura admin/gestor) |
| GET | `/api/auditoria` | Logs (admin/gestor): filtros `user`, `tipo`, `de`, `ate`, `q`, `limit` (≤ 5000) |
| POST | `/api/me/senha` | Troca da própria senha |
| GET | `/api/backup` · POST `/api/import` | Backup completo em JSON / importação (só admin) |

## 5. Regras de negócio implementadas

- **Perfis**: Administrador (vê tudo; único que cancela/exclui), Gestor (vê tudo, só consulta), Qualidade (vê todas as NCs, encerra), Colaborador (só as suas). Hierarquia por setor em Configurações: **gestor da área** + **equipe** + **custo médio ADM/Operação**.
- **Fluxo**: Rascunho → Em análise → Aguardando autorização (gestor da área) → Qualidade → Encerrada (+ Cancelada).
- **Obrigatórios**: título, descrição, data, origem, setor, severidade, responsável (usuário ativo), cliente/fornecedor e "Houve custo logístico?" (valor obrigatório se Sim). Rascunho exige só o título.
- **Custos**: prejuízo estimado (padrão = custo médio do setor) + custo logístico = prejuízo total; canceladas não entram no custo da não qualidade.
- **Prazo**: 3 dias corridos após a emissão (editável).
- **Responsável pelo tratamento**: obrigatório, começa vazio (não é preenchido com o gestor).
- **Data da justificativa**: automática (dia em que o responsável escreve/altera a justificativa).
- **Plano de ação 5W2H e verificação de eficácia** existem no código, mas estão **desligados** (`PLANO_ACAO = False` em `server.py` **e** em `app.js`).

## 6. Dicas para evoluir

- Testes: suba uma instância separada com `--port` e `--data` apontando para uma **cópia** do banco.
- Para publicar na internet, colocar atrás de um proxy HTTPS e ajustar o cookie para `Secure`; hoje o sistema foi pensado para LAN.
- Backup: copiar `data/melting-nc.db` com o servidor parado (ou `GET /api/backup`).

## 7. O que NÃO está neste pacote

- **Banco de dados real** (`data/`): contém NCs reais, logs de acesso e senhas (hash). Para dados de teste, peça ao administrador um **backup pelo sistema** ou uma cópia controlada do banco.
- Vídeos de treinamento (arquivos grandes, não são código).
- Documentação de uso: o POP **POP-QUA-001** está em `docs/`.

---

## Versão online (nc-melting.com.br)

O sistema também roda na internet, além da rede interna:

- **Site (public/)**: hospedado na Hostinger. Todo push na branch `main` que mexa em `public/` publica sozinho
  (GitHub Actions → branch `site` → Hostinger). Não edite o `public_html` direto na Hostinger: ele é sobrescrito.
- **Servidor**: `supabase/functions/api/index.ts` (Supabase Edge Function), tradução fiel do `server.py`
  com as mesmas rotas e regras. **Toda mudança de regra no `server.py` precisa ser repetida nele.**
- **Banco**: PostgreSQL do Supabase, schema `nc` (ver `supabase/schema.sql`).
- `public/config.js` aponta o site para o servidor na nuvem. Sem esse arquivo, o `app.js` usa `/api`
  no mesmo endereço (modo rede interna com o `server.py`).
- No `app.js`, não remova o bloco `API_BASE / REMOTE / token` nem o 4º parâmetro (`email`) de `showTempPassword`:
  é o que faz o login funcionar na nuvem e mostra se a senha provisória foi enviada por e-mail.
- Detalhes em `supabase/GUIA-PUBLICACAO.md`.
