/**
 * Melting · Gestão de Não Conformidades — servidor (Supabase Edge Function "api").
 *
 * Tradução fiel do server.py: mesmas rotas /api/*, mesmas regras de permissão, fluxo, histórico e validações.
 * Diferenças por rodar na nuvem:
 *   - Banco: PostgreSQL do Supabase (schema "nc", ver supabase/schema.sql), acesso direto via SUPABASE_DB_URL.
 *   - Sessão: token enviado no cabeçalho X-NC-Token (o site fica em outro domínio, então não há cookie).
 *     Para <img src> de anexos e para o download do backup, o token vai em ?t=.
 *   - Bloqueio de tentativas de login guardado no banco (tabela nc.login_fails).
 *   - "Hoje" calculado no fuso America/Sao_Paulo.
 *   - Backup diário: feito pelo próprio Supabase (plano Pro).
 */
import postgres from 'npm:postgres@3.4.5';
import { Buffer } from 'node:buffer';
import { enviarSenha } from './email.ts';

const VERSAO = '2.0-supabase';
const SESSION_DAYS = 14;
const MAX_BODY = 25 * 1024 * 1024;
const MAX_FILE = 8 * 1024 * 1024;
const FILE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);
const TZ = 'America/Sao_Paulo';
const LOCK_ID = 7240001; // trava global de escrita (equivale ao BEGIN IMMEDIATE do SQLite)

// Plano de ação (5W2H) e verificação de eficácia desativados por enquanto (fluxo simplificado).
// Para reativar: true aqui e PLANO_ACAO = true no public/app.js.
const PLANO_ACAO = false;
const FLOW = PLANO_ACAO
  ? ['aberta', 'analise', 'acao', 'verificacao', 'autorizacao', 'encerrada']
  : ['aberta', 'analise', 'autorizacao', 'encerrada'];
const STATUS_LABEL: Record<string, string> = {
  aberta: 'Aberta', analise: 'Em análise', acao: 'Ação em andamento', verificacao: 'Verificação de eficácia',
  autorizacao: 'Aguardando autorização', encerrada: 'Encerrada', cancelada: 'Cancelada',
};
const PERFIS = ['admin', 'qualidade', 'colaborador'];
const GESTAO = ['admin', 'qualidade'];
const REQUIRED: [string, string][] = [
  ['titulo', 'Título'], ['descricao', 'Descrição'], ['dataOcorrencia', 'Data da ocorrência'], ['tipo', 'Tipo'],
  ['setor', 'Setor de origem da NC'], ['responsavel', 'Responsável'], ['severidade', 'Severidade'],
  ['cliente', 'Cliente / Fornecedor'], ['origem', 'Origem / como foi detectada'],
];
const MANAGED = new Set(['id', 'numero', 'status', 'version', 'updatedAt', 'anexos', 'historico', 'criadoPor', 'criadoPorId',
  'createdAt', 'dataRegistro', 'encerramento']);
const DEFAULT_CFG = {
  prefixo: 'NC',
  setores: ['Usinagem', 'Caldeiraria', 'Solda', 'Montagem', 'Bobinagem / Elétrica', 'Balanceamento', 'Pintura',
    'Serviço de campo', 'Almoxarifado', 'Expedição', 'Engenharia', 'Qualidade', 'Compras', 'Comercial', 'SESMT'],
  tipos: ['Produto', 'Processo', 'Serviço', 'Sistema de gestão', 'Fornecedor', 'Reclamação de cliente',
    'Segurança do trabalho', 'Meio ambiente'],
  origens: ['Inspeção de recebimento', 'Inspeção em processo', 'Inspeção final', 'Auditoria interna',
    'Auditoria externa / certificação', 'Reclamação de cliente', 'Observação de campo', 'Indicador de desempenho'],
  disposicoes: ['Retrabalho', 'Reparo', 'Uso como está (concessão do cliente)', 'Reclassificação', 'Sucata',
    'Devolução ao fornecedor', 'Não aplicável'],
  responsaveis: [],
  setorResp: {},      // (legado) substituído por setorGestor
  setorGestor: {},    // setor -> nome do usuário gestor da área (encerra as NCs do setor)
  setorUsuarios: {},  // setor -> [nomes dos usuários da área]
  setorCusto: {},     // setor -> custo médio de uma NC ("1234.00"), usado como prejuízo estimado padrão
};

// deno-lint-ignore no-explicit-any
type Any = any;
type Db = Any; // postgres.Sql ou transação

const sql = postgres(Deno.env.get('SUPABASE_DB_URL') ?? '', {
  prepare: false, max: 3, idle_timeout: 20, connect_timeout: 15,
  types: { bigint: { to: 20, from: [20], serialize: (x: Any) => String(x), parse: (x: string) => Number(x) } },
});

// ---------------------------------------------------------------- utilidades
const nowIso = () => new Date().toISOString();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const norm = (s: Any) => String(s || '').trim().toLowerCase();
const isObj = (x: Any) => x !== null && typeof x === 'object' && !Array.isArray(x);
const str = (v: Any) => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const sliceCp = (s: string, a: number, b?: number) => Array.from(s).slice(a, b).join('');

class ApiError extends Error {
  constructor(public status: number, public msg: string, public extra: Record<string, Any> = {}) { super(msg); }
}

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const unhex = (h: string) => new Uint8Array((h.match(/../g) || []).map(x => parseInt(x, 16)));
const randBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const tokenHex = (n: number) => hex(randBytes(n));
const tokenUrlsafe = (n: number) => btoa(String.fromCharCode(...randBytes(n))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function tx<T>(fn: (t: Db) => Promise<T>): Promise<T> {
  return await sql.begin(async (t: Db) => {
    await t`select pg_advisory_xact_lock(${LOCK_ID})`;
    return await fn(t);
  }) as T;
}

async function nextRev(db: Db): Promise<number> {
  const [r] = await db`insert into nc.kv(k,v) values('rev','1')
    on conflict(k) do update set v=(nc.kv.v::bigint+1)::text returning v`;
  return Number(r.v);
}

async function curRev(db: Db): Promise<number> {
  const [r] = await db`select v from nc.kv where k='rev'`;
  return r ? Number(r.v) : 0;
}

async function getCfg(db: Db) {
  const [r] = await db`select v from nc.kv where k='cfg'`;
  const cfg: Any = structuredClone(DEFAULT_CFG);
  if (r) Object.assign(cfg, JSON.parse(r.v));
  return cfg;
}

async function saveCfg(db: Db, cfg: Any) {
  const v = JSON.stringify(cfg);
  await db`insert into nc.kv(k,v) values('cfg',${v}) on conflict(k) do update set v=excluded.v`;
}

// ---------------------------------------------------------------- senhas (mesmo formato do server.py)
async function pbkdf2(pw: string, salt: Uint8Array<ArrayBuffer>, it: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: it }, key, 256));
}

async function hashPw(pw: string) {
  const salt = randBytes(16);
  const it = 240_000;
  return `pbkdf2$${it}$${hex(salt)}$${hex(await pbkdf2(pw, salt, it))}`;
}

async function checkPw(pw: string, stored: string) {
  try {
    const [, it, salt, h] = stored.split('$');
    const calc = hex(await pbkdf2(pw, unhex(salt), parseInt(it)));
    if (calc.length !== h.length) return false;
    let diff = 0;
    for (let i = 0; i < calc.length; i++) diff |= calc.charCodeAt(i) ^ h.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

function tempPassword() {
  const alfabeto = 'abcdefghjkmnpqrstuvwxyz23456789';
  const pick = () => alfabeto[crypto.getRandomValues(new Uint32Array(1))[0] % alfabeto.length];
  return Array.from({ length: 4 }, pick).join('') + '-' + Array.from({ length: 4 }, pick).join('');
}

function validatePw(pw: Any) {
  if (String(pw || '').length < 6) throw new ApiError(422, 'A senha deve ter pelo menos 6 caracteres.');
}

// ---------------------------------------------------------------- usuários
function userOut(r: Any, full = false) {
  const u: Any = { id: r.id, nome: r.nome, login: r.login, perfil: r.perfil, email: r.email || '', trocarSenha: !!r.trocar_senha };
  if (full) Object.assign(u, { ativo: !!r.ativo, criadoEm: r.criado_em, ultimoAcesso: r.ultimo_acesso });
  return u;
}

async function pessoas(db: Db): Promise<string[]> {
  const rows = await db`select nome from nc.users where ativo order by lower(nome), nome`;
  return rows.map((r: Any) => r.nome);
}

async function newSession(db: Db, userId: number) {
  const token = tokenUrlsafe(32);
  const now = Date.now() / 1000;
  await db`insert into nc.sessions(token,user_id,expira) values(${token},${userId},${now + SESSION_DAYS * 86400})`;
  await db`delete from nc.sessions where expira<${now}`;
  await db`update nc.users set ultimo_acesso=${nowIso()} where id=${userId}`;
  return token;
}

async function activeAdmins(db: Db, excluding?: number) {
  const [r] = excluding === undefined
    ? await db`select count(*)::int n from nc.users where perfil='admin' and ativo`
    : await db`select count(*)::int n from nc.users where perfil='admin' and ativo and id<>${excluding}`;
  return r.n as number;
}

// ---------------------------------------------------------------- NCs
async function anexosMeta(db: Db, ncIds?: string[]) {
  const rows = ncIds === undefined
    ? await db`select id,nc_id,nome,tipo,tamanho,criado_em,por from nc.anexos order by criado_em`
    : ncIds.length
      ? await db`select id,nc_id,nome,tipo,tamanho,criado_em,por from nc.anexos where nc_id in ${db(ncIds)} order by criado_em`
      : [];
  const out: Record<string, Any[]> = {};
  for (const r of rows) {
    (out[r.nc_id] ||= []).push({ id: r.id, nome: r.nome, tipo: r.tipo, tamanho: r.tamanho, em: r.criado_em, por: r.por });
  }
  return out;
}

function ncOut(row: Any, anx: Record<string, Any[]>) {
  const d = structuredClone(row.data);
  Object.assign(d, { id: row.id, numero: row.numero, status: row.status, version: row.version, updatedAt: row.updated_at });
  d.anexos = anx[row.id] || [];
  return d;
}

async function loadNc(db: Db, ncId: string) {
  const [row] = await db`select * from nc.ncs where id=${ncId}`;
  if (!row) throw new ApiError(404, 'Não conformidade não encontrada (pode ter sido excluída).');
  return row;
}

function clean(nc: Any) {
  if (!isObj(nc)) throw new ApiError(400, 'Dados inválidos.');
  const d: Any = {};
  for (const [k, v] of Object.entries(nc)) if (!MANAGED.has(k) && !k.startsWith('_')) d[k] = v;
  if (JSON.stringify(d).length > 1_500_000) throw new ApiError(413, 'Registro muito grande.');
  if (!Array.isArray(d.acoes ?? [])) d.acoes = [];
  for (const k of ['cliente', 'titulo']) {   // Cliente e Título sempre em MAIÚSCULAS
    if (typeof d[k] === 'string') d[k] = d[k].trim().toUpperCase();
  }
  return d;
}

function stable(v: Any): Any {
  if (Array.isArray(v)) return v.map(stable);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])]));
  return v;
}

function contentKey(d: Any) {
  const x: Any = {};
  for (const [k, v] of Object.entries(d)) if (!MANAGED.has(k)) x[k] = v;
  x._comentario = (d.encerramento || {}).comentario ?? '';
  return JSON.stringify(stable(x));
}

function num(v: Any) {
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function checkCustoLog(d: Any, nova = false) {
  // Custo logístico: na abertura é preciso responder Sim/Não; se Sim, o valor é obrigatório.
  const h = d.custoLogHouve || '';
  if (nova && h !== 'sim' && h !== 'nao') {
    throw new ApiError(422, 'Informe se houve custo logístico (Sim ou Não).', { campos: ['custoLogHouve'] });
  }
  if (h === 'sim' && !(num(d.custoLog) > 0)) throw new ApiError(422, 'Informe o valor do custo logístico.', { campos: ['custoLog'] });
  if (h !== 'sim' && d.custoLog) d.custoLog = '';
}

function checkRequired(d: Any) {
  const falta = REQUIRED.filter(([f]) => !str(d[f] || '').trim());
  if (falta.length) {
    throw new ApiError(422, 'Preencha: ' + falta.map(([, l]) => l).join(', '), { campos: falta.map(([f]) => f) });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str(d.dataOcorrencia))) {
    throw new ApiError(422, 'Data da ocorrência inválida.', { campos: ['dataOcorrencia'] });
  }
}

async function checkResponsavel(db: Db, d: Any, old?: Any) {
  // O responsável pela NC deve ser um usuário ativo (exigido em NCs novas e quando o responsável é trocado).
  if (old !== undefined && norm(old.responsavel) === norm(d.responsavel)) return;
  if (!(await pessoas(db)).includes(str(d.responsavel || '').trim())) {
    throw new ApiError(422, 'O responsável pela NC deve ser um usuário cadastrado e ativo no sistema.', { campos: ['responsavel'] });
  }
}

function missingFor(d: Any, status: string) {
  const m: string[] = [];
  const acoes: Any[] = Array.isArray(d.acoes) ? d.acoes : [];
  if (status === 'aberta') {
    if (!str((d.contencao || {}).descricao || '').trim()) m.push('Descreva a ação imediata / contenção (seção 2).');
  } else if (status === 'analise') {
    if (!str((d.causa || {}).causaRaiz || '').trim()) m.push('Informe a causa raiz (seção 3).');
    if (!PLANO_ACAO) { /* plano de ação desativado */ }
    else if (!acoes.length) m.push('Cadastre ao menos uma ação no plano de ação (seção 4).');
    else if (acoes.some(a => !str(a.descricao || '').trim() || !str(a.responsavel || '').trim() || !a.prazo)) {
      m.push('Preencha O quê, Quem e Quando de todas as ações.');
    }
  } else if (status === 'acao') {
    if (acoes.some(a => a.status !== 'Concluída')) m.push('Todas as ações do plano precisam estar concluídas.');
  } else if (status === 'verificacao') {
    const ef = d.eficacia || {};
    if (ef.resultado !== 'eficaz') m.push('Registre a verificação de eficácia como "Eficaz" (seção 5).');
    if (!str(ef.evidencia || '').trim()) m.push('Descreva a evidência que comprova a eficácia.');
  }
  return m;
}

const gestorSetor = (cfg: Any, setor: Any) => str(((cfg || {}).setorGestor || {})[setor || ''] || '');

function doSetor(cfg: Any, setor: Any, nome: Any) {
  // Usuário é o gestor ou faz parte da equipe do setor.
  const nm = norm(nome);
  if (!nm || !setor) return false;
  const equipe: Any[] = ((cfg || {}).setorUsuarios || {})[setor] || [];
  return nm === norm(gestorSetor(cfg, setor)) || equipe.some(x => nm === norm(x));
}

function podeEncerrar(user: Any, d: Any, cfg: Any) {
  // Encerramento: gestor da área da NC. O administrador pode sempre; sem gestor definido, a Qualidade também.
  if (user.perfil === 'admin') return true;
  const g = gestorSetor(cfg, d.setor);
  if (g) return norm(user.nome) === norm(g);
  return GESTAO.includes(user.perfil);
}

const acoesOf = (d: Any): Any[] => (Array.isArray(d.acoes) ? d.acoes : []).filter(isObj);

function canView(user: Any, d: Any, status: string, cfg: Any) {
  // Visibilidade: o administrador vê todo o cenário; os demais veem só as NCs que são deles.
  if (user.perfil === 'admin') return true;
  if (d.criadoPorId === user.id) return true;
  const nm = norm(user.nome);
  if (nm === norm(d.responsavel) || acoesOf(d).some(a => nm === norm(a.responsavel))) return true;
  const g = gestorSetor(cfg, d.setor);
  if (g && nm === norm(g)) return true;
  return status === 'autorizacao' && podeEncerrar(user, d, cfg);
}

async function visiveis(db: Db, user: Any, rows: Any[], cfg?: Any) {
  if (user.perfil === 'admin') return rows;
  cfg = cfg || await getCfg(db);
  return rows.filter(r => canView(user, r.data, r.status, cfg));
}

async function loadVisivel(db: Db, user: Any, ncId: string, cfg?: Any) {
  const row = await loadNc(db, ncId);
  if (!canView(user, row.data, row.status, cfg || await getCfg(db))) {
    throw new ApiError(404, 'Não conformidade não encontrada (ou você não tem acesso a ela).');
  }
  return row;
}

function canEdit(user: Any, d: Any, status: string, cfg: Any) {
  if (GESTAO.includes(user.perfil)) return true;
  if (status === 'encerrada' || status === 'cancelada') return false;
  if (d.criadoPorId === user.id) return true;
  const nm = norm(user.nome);
  return nm === norm(d.responsavel) || acoesOf(d).some(a => nm === norm(a.responsavel)) || doSetor(cfg, d.setor, user.nome);
}

function checkTransition(user: Any, d: Any, frm: string, to: string, cfg: Any) {
  if (frm === to) return;
  if (!(to in STATUS_LABEL)) throw new ApiError(400, 'Status inválido.');
  const gestao = GESTAO.includes(user.perfil);
  if (to === 'cancelada') {
    if (user.perfil !== 'admin') throw new ApiError(403, 'Somente o administrador pode cancelar uma NC.');
    return;
  }
  if (frm === 'encerrada' || frm === 'cancelada') {
    if (!gestao) throw new ApiError(403, 'Somente Qualidade ou Administrador podem reabrir uma NC.');
    if (to === 'encerrada') throw new ApiError(422, 'Reabra a NC antes de encerrá-la novamente.');
    return;
  }
  if (!FLOW.includes(to)) throw new ApiError(422, `A etapa "${STATUS_LABEL[to]}" não está em uso.`);
  // NC que estava numa etapa desativada conta como "Em análise"
  const fi = FLOW.includes(frm) ? FLOW.indexOf(frm) : FLOW.indexOf('analise');
  const ti = FLOW.indexOf(to);
  if (ti > fi) {
    for (let i = fi; i < ti; i++) {
      const m = missingFor(d, FLOW[i]);
      if (m.length) throw new ApiError(422, `Pendências na etapa "${STATUS_LABEL[FLOW[i]]}".`, { pendencias: m, etapa: FLOW[i] });
    }
    if (to === 'encerrada' && !podeEncerrar(user, d, cfg)) {
      const g = gestorSetor(cfg, d.setor);
      throw new ApiError(403, g ? `O encerramento desta NC é feito pelo gestor da área (${g}).`
        : 'O encerramento é feito pelo gestor da área. Este setor ainda não tem gestor definido — peça ao administrador para defini-lo em Configurações.');
    }
  } else if (!gestao && !(frm === 'verificacao' && to === 'analise') && !(frm === 'autorizacao' && podeEncerrar(user, d, cfg))) {
    throw new ApiError(403, 'Somente o gestor da área, a Qualidade ou o Administrador podem retornar etapas.');
  }
}

async function nextNumero(db: Db, year: string) {
  const pre = `${(await getCfg(db)).prefixo || 'NC'}-${year}-`;
  let mx = 0;
  const rows = await db`select numero from nc.ncs where starts_with(numero, ${pre})`;
  for (const { numero } of rows) {
    const rest = numero.slice(pre.length);
    if (/^\s*[+-]?\d+\s*$/.test(rest)) mx = Math.max(mx, parseInt(rest, 10));
  }
  return pre + String(mx + 1).padStart(3, '0');
}

function hist(d: Any, user: Any, acao: string, alteracoes?: Any[]) {
  const e: Any = { data: nowIso(), usuario: user.nome, acao };
  if (alteracoes && alteracoes.length) e.alteracoes = alteracoes;
  if (!Array.isArray(d.historico)) d.historico = [];
  d.historico.push(e);
}

// Campos rastreados no histórico (caminho, rótulo)
const NC_FIELDS: [string, string][] = [
  ['titulo', 'Título'], ['descricao', 'Descrição'], ['dataOcorrencia', 'Data da ocorrência'], ['tipo', 'Tipo'],
  ['origem', 'Origem'], ['classificacao', 'Classificação'], ['setor', 'Setor de origem da NC'], ['severidade', 'Severidade'],
  ['cliente', 'Cliente / Fornecedor'], ['os', 'Nº Pedido / NF / OC'], ['item', 'Item / equipamento'], ['quantidade', 'Quantidade afetada'],
  ['custo', 'Prejuízo estimado'], ['custoLogHouve', 'Houve custo logístico?'], ['custoLog', 'Custo logístico'], ['detectadoPor', 'Detectado por'],
  ['responsavel', 'Responsável'], ['prazo', 'Prazo'], ['reincidente', 'Reincidente'], ['ncRelacionada', 'NC relacionada'],
  ['contencao.descricao', 'Contenção'], ['contencao.disposicao', 'Disposição do produto'],
  ['contencao.responsavel', 'Responsável pela contenção'], ['contencao.data', 'Data da contenção'],
  ...[0, 1, 2, 3, 4].map(i => [`causa.porques.${i}`, `${i + 1}º Por quê`] as [string, string]),
  ['causa.causaRaiz', 'Causa raiz'],
  ['eficacia.resultado', 'Eficácia — resultado'], ['eficacia.responsavel', 'Eficácia — verificado por'],
  ['eficacia.data', 'Eficácia — data'], ['eficacia.evidencia', 'Eficácia — evidência'],
  ['encerramento.comentario', 'Comentário de encerramento'],
];
const ACAO_FIELDS: [string, string][] = [['descricao', 'O quê'], ['tipo', 'Tipo'], ['porque', 'Por quê'], ['onde', 'Onde'],
  ['responsavel', 'Quem'], ['como', 'Como'], ['prazo', 'Quando'], ['custo', 'Quanto custa'], ['status', 'Status'],
  ['conclusao', 'Concluída em'], ['obs', 'Evidência de execução']];
const VALUE_LABELS: Record<string, Record<string, string>> = {
  severidade: { baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'Crítica' },
  reincidente: { sim: 'Sim', nao: 'Não' },
  custoLogHouve: { '': '—', sim: 'Sim', nao: 'Não' },
  'eficacia.resultado': { '': 'Pendente', eficaz: 'Eficaz', ineficaz: 'Não eficaz' },
};

function getPath(d: Any, path: string): Any {
  for (const k of path.split('.')) {
    if (Array.isArray(d)) d = /^\d+$/.test(k) && +k < d.length ? d[+k] : null;
    else if (isObj(d)) d = d[k];
    else return null;
  }
  return d;
}

function brMoney(n: number) {
  const [i, f] = Math.abs(n).toFixed(2).split('.');
  return (n < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + f;
}

function fmt(path: string, v0: Any) {
  const v = str(v0).trim();
  if (path in VALUE_LABELS) return VALUE_LABELS[path][v] ?? v;
  if (['custo', 'custoLog'].includes(path.split('.').pop()!) && v) {
    const n = Number(v);
    return Number.isFinite(n) ? 'R$ ' + brMoney(n) : v;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
  return sliceCp(v, 0, 400) + (Array.from(v).length > 400 ? '…' : '');
}

function diffNc(old: Any, nw: Any) {
  // Lista de alterações {campo, de, para} entre duas versões de uma NC.
  const out: Any[] = [];
  for (const [path, label] of NC_FIELDS) {
    const a = fmt(path, getPath(old, path)), b = fmt(path, getPath(nw, path));
    if (a !== b) out.push({ campo: label, de: a, para: b });
  }
  const olds = new Map<Any, Any>();
  for (const a of acoesOf(old)) olds.set(a.id ?? null, a);
  acoesOf(nw).forEach((a, idx) => {
    const i = idx + 1;
    const key = a.id ?? null;
    const prev = olds.get(key);
    olds.delete(key);
    if (prev === undefined) {
      out.push({ campo: `Ação ${i}`, de: '', para: 'Adicionada: ' + fmt('', a.descricao) });
      return;
    }
    for (const [k, label] of ACAO_FIELDS) {
      const x = fmt(k, prev[k]), y = fmt(k, a[k]);
      if (x !== y) out.push({ campo: `Ação ${i} — ${label}`, de: x, para: y });
    }
  });
  for (const a of olds.values()) out.push({ campo: 'Ação', de: fmt('', a.descricao), para: 'Removida' });
  return out;
}

async function writeNc(db: Db, id: string, numero: string, status: string, version: number, d: Any, insert = false) {
  const rev = await nextRev(db);
  const upd = nowIso();
  if (insert) {
    await db`insert into nc.ncs(id,numero,status,version,rev,updated_at,data)
      values(${id},${numero},${status},${version},${rev},${upd},${db.json(d)})`;
  } else {
    await db`update nc.ncs set numero=${numero},status=${status},version=${version},rev=${rev},updated_at=${upd},data=${db.json(d)}
      where id=${id}`;
  }
}

function decodeDataUrl(s: Any): [string, Uint8Array] {
  const m = /^data:([\w/+.-]+);base64,([\s\S]*)$/.exec(typeof s === 'string' ? s : '');
  if (!m) throw new ApiError(400, 'Arquivo inválido.');
  try {
    return [m[1], new Uint8Array(Buffer.from(m[2].replace(/\s/g, ''), 'base64'))];
  } catch {
    throw new ApiError(400, 'Arquivo inválido.');
  }
}

function proxDiaUtil(iso: string) {
  // Prazo padrão: 1 dia útil após a abertura, pulando sábado e domingo.
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

const cleanId = (s: Any) => sliceCp(str(s).replace(/[^\p{L}\p{N}_-]/gu, ''), 0, 40);

// ---------------------------------------------------------------- rotas
type Ctx = { req: Request; user: Any; body: Any; q: URLSearchParams; params: Record<string, string>; token: string | null; ip: string };
type Handler = (c: Ctx) => Promise<Any>;
const ROUTES: [string, RegExp, Handler, boolean][] = [];
const route = (method: string, pattern: string, fn: Handler, isPublic = false) =>
  ROUTES.push([method, new RegExp('^' + pattern + '$', 'u'), fn, isPublic]);
const ID = '(?<id>[\\p{L}\\p{N}_-]+)';

class Raw { constructor(public body: Uint8Array | string, public type: string, public headers: Record<string, string> = {}) {} }

route('GET', '/api/status', async () => {
  const [r] = await sql`select count(*)::int n from nc.users`;
  return { setup: r.n === 0, versao: VERSAO };
}, true);

route('POST', '/api/setup', async ({ body }) => {
  const nome = str(body.nome ?? '').trim(), login = str(body.login ?? '').trim(), senha = body.senha ?? '';
  if (!nome || !login) throw new ApiError(422, 'Informe nome e usuário.');
  validatePw(senha);
  const hash = await hashPw(String(senha));
  const token = await tx(async t => {
    const [c] = await t`select count(*)::int n from nc.users`;
    if (c.n) throw new ApiError(409, 'O sistema já foi configurado.');
    const [u] = await t`insert into nc.users(nome,login,senha,perfil,criado_em) values(${nome},${login},${hash},'admin',${nowIso()}) returning id`;
    return await newSession(t, u.id);
  });
  return { ok: true, token };
}, true);

route('POST', '/api/login', async ({ body, ip }) => {
  const now = Date.now() / 1000;
  const [lf] = await sql`select fails, ate from nc.login_fails where ip=${ip}`;
  let fails = lf ? lf.fails : 0;
  const until = lf ? lf.ate : 0;
  if (until > now) throw new ApiError(429, `Muitas tentativas. Aguarde ${Math.floor(until - now) + 1} segundos.`);
  const login = str(body.login ?? '').trim(), senha = str(body.senha ?? '');
  const [r] = await sql`select * from nc.users where lower(login)=lower(${login})`;
  const ok = r ? await checkPw(senha, r.senha) : false;
  if (!r || !ok || !r.ativo) {
    fails += 1;
    // 5 tentativas erradas seguidas bloqueiam o IP por 60 s
    const [f, a] = fails >= 5 ? [0, now + 60] : [fails, 0];
    await sql`insert into nc.login_fails(ip,fails,ate) values(${ip},${f},${a})
      on conflict(ip) do update set fails=excluded.fails, ate=excluded.ate`;
    if (r && !r.ativo && ok) throw new ApiError(403, 'Usuário desativado. Procure o administrador.');
    throw new ApiError(401, 'Usuário ou senha incorretos.');
  }
  await sql`delete from nc.login_fails where ip=${ip}`;
  const token = await tx(t => newSession(t, r.id));
  return { ok: true, token };
}, true);

route('POST', '/api/logout', async ({ token }) => {
  if (token) await sql`delete from nc.sessions where token=${token}`;
  return { ok: true };
}, true);

route('GET', '/api/bootstrap', async ({ user }) => {
  const rev = await curRev(sql);
  const rows = await visiveis(sql, user, await sql`select * from nc.ncs`);
  const anx = rows.length ? await anexosMeta(sql, rows.map((r: Any) => r.id)) : {};
  return { me: userOut(user), cfg: await getCfg(sql), pessoas: await pessoas(sql), rev, ncs: rows.map((r: Any) => ncOut(r, anx)), versao: VERSAO };
});

route('GET', '/api/ncs', async ({ user, q }) => {
  const since = parseInt(q.get('since') || '0', 10) || 0;
  const rev = await curRev(sql);
  const cfg = await getCfg(sql);
  const vis = await visiveis(sql, user, await sql`select * from nc.ncs`, cfg);
  const ids = vis.map((r: Any) => r.id);
  const rows = vis.filter((r: Any) => r.rev > since);
  const anx = rows.length ? await anexosMeta(sql, rows.map((r: Any) => r.id)) : {};
  return { rev, changed: rows.map((r: Any) => ncOut(r, anx)), ids, cfg, pessoas: await pessoas(sql) };
});

route('POST', '/api/ncs', async ({ user, body }) => {
  const d = clean(body.nc);
  checkRequired(d);
  checkCustoLog(d, true);
  await checkResponsavel(sql, d);
  d.criadoPor = user.nome;
  d.criadoPorId = user.id;
  d.dataRegistro = today();
  d.createdAt = nowIso();
  if (!d.prazo) d.prazo = proxDiaUtil(d.dataRegistro);
  if (!num(d.custo)) {   // sem prejuízo informado: usa o custo médio do setor (Configurações)
    const cm = ((await getCfg(sql)).setorCusto || {})[d.setor || ''];
    if (cm) d.custo = cm;
  }
  d.encerramento = { data: '', por: '', comentario: str(((body.nc || {}).encerramento || {}).comentario ?? '') };
  d.historico = [];
  hist(d, user, 'Não conformidade registrada');
  const ncId = tokenHex(8);
  await tx(async t => {
    const numero = await nextNumero(t, String(d.dataOcorrencia).slice(0, 4));
    await writeNc(t, ncId, numero, 'aberta', 1, d, true);
  });
  return { nc: ncOut(await loadNc(sql, ncId), await anexosMeta(sql, [ncId])) };
});

route('PUT', `/api/ncs/${ID}`, async ({ user, body, params: { id } }) => {
  const ncIn = isObj(body.nc) ? body.nc : {};
  return await tx(async t => {
    const cfg = await getCfg(t);
    const row = await loadVisivel(t, user, id, cfg);
    const old = row.data;
    const frm = row.status;
    if (!canEdit(user, old, frm, cfg)) {
      throw new ApiError(403, 'Você não tem permissão para alterar esta NC. Ela pode ser editada pelo responsável, por quem a registrou ou pela Qualidade.');
    }
    if (!body.force && body.version !== row.version) {
      const h = Array.isArray(old.historico) && old.historico.length ? old.historico[old.historico.length - 1] : {};
      throw new ApiError(409, 'Esta NC foi alterada por outro usuário enquanto você editava.',
        { nc: ncOut(row, await anexosMeta(t, [id])), por: h.usuario ?? null, em: h.data ?? null });
    }
    const d = clean(ncIn);
    for (const k of ['criadoPor', 'criadoPorId', 'createdAt', 'dataRegistro']) if (k in old) d[k] = old[k];
    d.historico = Array.isArray(old.historico) ? [...old.historico] : [];
    const enc = { ...(isObj(old.encerramento) ? old.encerramento : { data: '', por: '' }) };
    const encIn = isObj(ncIn.encerramento) ? ncIn.encerramento : {};
    enc.comentario = sliceCp(str('comentario' in encIn ? encIn.comentario : (enc.comentario ?? '')), 0, 5000);
    d.encerramento = enc;
    const to = ncIn.status || frm;
    checkRequired(d);
    checkCustoLog(d);
    await checkResponsavel(t, d, old);
    checkTransition(user, d, frm, to, cfg);
    const changed = contentKey(d) !== contentKey(old);
    if (changed) {
      const alt = diffNc(old, d);
      hist(d, user, alt.length ? 'Registro atualizado' : 'Registro atualizado (sem mudança de conteúdo)', alt);
    }
    const nota = str(body.nota || '').trim();
    if (nota) hist(d, user, sliceCp(nota, 0, 2000));
    if (to !== frm) {
      hist(d, user, `Status: ${STATUS_LABEL[frm]} → ${STATUS_LABEL[to]}`);
      if (to === 'encerrada') Object.assign(d.encerramento, { data: today(), por: user.nome });
      else if (frm === 'encerrada') Object.assign(d.encerramento, { data: '', por: '' });
    }
    if (!changed && !nota && to === frm) return { nc: ncOut(row, await anexosMeta(t, [id])) };
    await writeNc(t, id, row.numero, to, row.version + 1, d);
    return { nc: ncOut(await loadNc(t, id), await anexosMeta(t, [id])) };
  });
});

route('DELETE', `/api/ncs/${ID}`, async ({ user, params: { id } }) => {
  if (user.perfil !== 'admin') throw new ApiError(403, 'Somente o administrador pode excluir NCs.');
  await tx(async t => {
    await loadNc(t, id);
    await t`delete from nc.ncs where id=${id}`;
    await nextRev(t);
  });
  return { ok: true };
});

route('POST', `/api/ncs/${ID}/anexos`, async ({ user, body, params: { id } }) => {
  let [tipo, raw] = decodeDataUrl(body.data);
  tipo = body.tipo || tipo;
  if (!FILE_TYPES.has(tipo)) throw new ApiError(415, 'Formato não suportado. Use imagens ou PDF.');
  if (raw.length > MAX_FILE) throw new ApiError(413, `Arquivo maior que ${MAX_FILE / 1024 / 1024} MB.`);
  const nome = sliceCp(str(body.nome || 'arquivo'), 0, 200);
  const aid = tokenHex(8);
  await tx(async t => {
    const row = await loadVisivel(t, user, id);
    const d = row.data;
    if (!canEdit(user, d, row.status, await getCfg(t))) throw new ApiError(403, 'Você não tem permissão para anexar arquivos nesta NC.');
    await t`insert into nc.anexos(id,nc_id,nome,tipo,tamanho,conteudo,criado_em,por)
      values(${aid},${id},${nome},${tipo},${raw.length},${Buffer.from(raw)},${nowIso()},${user.nome})`;
    hist(d, user, `Anexo adicionado: ${nome}`);
    await writeNc(t, id, row.numero, row.status, row.version, d);
  });
  return { anexo: (await anexosMeta(sql, [id]))[id].find(a => a.id === aid) };
});

route('GET', `/api/anexos/${ID}`, async ({ user, params: { id } }) => {
  const [r] = await sql`select nome,tipo,conteudo,nc_id from nc.anexos where id=${id}`;
  if (!r) throw new ApiError(404, 'Anexo não encontrado.');
  await loadVisivel(sql, user, r.nc_id);
  return new Raw(new Uint8Array(r.conteudo), r.tipo, {
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(r.nome)}`,
    'Cache-Control': 'private, max-age=604800',
  });
});

route('DELETE', `/api/anexos/${ID}`, async ({ user, params: { id } }) => {
  await tx(async t => {
    const [a] = await t`select nc_id,nome from nc.anexos where id=${id}`;
    if (!a) throw new ApiError(404, 'Anexo não encontrado.');
    const row = await loadVisivel(t, user, a.nc_id);
    const d = row.data;
    if (!canEdit(user, d, row.status, await getCfg(t))) throw new ApiError(403, 'Você não tem permissão para remover anexos desta NC.');
    await t`delete from nc.anexos where id=${id}`;
    hist(d, user, `Anexo removido: ${a.nome}`);
    await writeNc(t, row.id, row.numero, row.status, row.version, d);
  });
  return { ok: true };
});

route('PUT', '/api/config', async ({ user, body }) => {
  if (user.perfil !== 'admin') throw new ApiError(403, 'Somente o administrador altera as configurações.');
  const cfg = await getCfg(sql);
  for (const k of ['setores', 'tipos', 'origens', 'disposicoes', 'responsaveis']) {
    if (Array.isArray(body[k])) cfg[k] = body[k].map((x: Any) => sliceCp(str(x).trim(), 0, 120)).filter((x: string) => x);
  }
  if (body.prefixo) cfg.prefixo = str(body.prefixo).replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'NC';
  for (const k of ['setorResp', 'setorGestor']) {
    if (isObj(body[k])) {
      const ativos = await pessoas(sql);
      for (const nome of Object.values(body[k]) as Any[]) {
        if (nome && !ativos.includes(nome)) throw new ApiError(422, `"${nome}" não é um usuário ativo.`);
      }
      cfg[k] = Object.fromEntries(Object.entries(body[k]).filter(([, n]) => n).map(([s, n]) => [str(s), str(n)]));
    }
  }
  if (isObj(body.setorUsuarios)) {
    const ativos = await pessoas(sql);
    const novo: Any = {};
    for (const [s, nomes] of Object.entries(body.setorUsuarios) as [string, Any][]) {
      if (!Array.isArray(nomes)) continue;
      for (const nome of nomes) if (!ativos.includes(nome)) throw new ApiError(422, `"${nome}" não é um usuário ativo.`);
      if (nomes.length) novo[str(s)] = [...new Set(nomes.map((n: Any) => str(n)))];
    }
    cfg.setorUsuarios = novo;
  }
  if (isObj(body.setorCusto)) {
    const custos: Any = {};
    for (const [s, v] of Object.entries(body.setorCusto) as [string, Any][]) {
      const t = str(v).trim().replace(',', '.');
      const x0 = t ? Number(t) : NaN;
      if (!Number.isFinite(x0)) throw new ApiError(422, `Custo médio inválido para o setor "${s}".`);
      const x = Math.round(x0 * 100) / 100;
      if (x < 0 || x > 1e9) throw new ApiError(422, `Custo médio inválido para o setor "${s}".`);
      if (x > 0) custos[str(s)] = x.toFixed(2);
    }
    cfg.setorCusto = custos;
  }
  for (const k of ['setorResp', 'setorGestor', 'setorUsuarios', 'setorCusto']) {
    cfg[k] = Object.fromEntries(Object.entries(cfg[k] || {}).filter(([s]) => cfg.setores.includes(s)));
  }
  await saveCfg(sql, cfg);
  return { cfg };
});

function requireAdmin(user: Any) {
  if (user.perfil !== 'admin') throw new ApiError(403, 'Somente o administrador gerencia usuários.');
}

route('GET', '/api/users', async ({ user }) => {
  requireAdmin(user);
  const rows = await sql`select * from nc.users order by ativo desc, lower(nome), nome`;
  return { users: rows.map((r: Any) => userOut(r, true)) };
});

route('POST', '/api/users', async ({ user, body }) => {
  requireAdmin(user);
  const nome = str(body.nome ?? '').trim(), login = str(body.login ?? '').trim();
  const perfil = body.perfil;
  if (!nome || !login) throw new ApiError(422, 'Informe nome e usuário de acesso.');
  if (!/^[\p{L}\p{N}_.@-]{3,40}$/u.test(login)) throw new ApiError(422, 'Usuário de acesso: 3 a 40 caracteres, sem espaços.');
  if (!PERFIS.includes(perfil)) throw new ApiError(422, 'Perfil inválido.');
  const senha = body.senha || tempPassword();
  validatePw(senha);
  const hash = await hashPw(String(senha));
  try {
    await tx(async t => {
      await t`insert into nc.users(nome,login,email,senha,perfil,trocar_senha,criado_em)
        values(${nome},${login},${str(body.email ?? '').trim()},${hash},${perfil},true,${nowIso()})`;
      await nextRev(t);
    });
  } catch (e) {
    if ((e as Any)?.code === '23505') throw new ApiError(409, `Já existe um usuário com o login "${login}".`);
    throw e;
  }
  const email = await enviarSenha(nome, login, str(body.email ?? '').trim(), String(senha), true);
  return { ok: true, senha, email };
});

route('PUT', '/api/users/(?<id>\\d+)', async ({ user, body, params }) => {
  requireAdmin(user);
  const uid = parseInt(params.id, 10);
  const out: Any = { ok: true };
  const novaSenha = body.resetSenha ? tempPassword() : null;
  const novoHash = novaSenha ? await hashPw(novaSenha) : null;
  let dest: Any = null;
  await tx(async t => {
    const [r] = await t`select * from nc.users where id=${uid}`;
    if (!r) throw new ApiError(404, 'Usuário não encontrado.');
    const nome = str(body.nome ?? r.nome).trim() || r.nome;
    const perfil = 'perfil' in body ? body.perfil : r.perfil;
    const ativo = !!('ativo' in body ? body.ativo : r.ativo);
    if (!PERFIS.includes(perfil)) throw new ApiError(422, 'Perfil inválido.');
    if (r.perfil === 'admin' && r.ativo && (perfil !== 'admin' || !ativo) && await activeAdmins(t, uid) === 0) {
      throw new ApiError(422, 'É preciso manter pelo menos um administrador ativo.');
    }
    await t`update nc.users set nome=${nome},email=${str(body.email ?? (r.email || '')).trim()},perfil=${perfil},ativo=${ativo} where id=${uid}`;
    if (novaSenha) {
      await t`update nc.users set senha=${novoHash},trocar_senha=true where id=${uid}`;
      await t`delete from nc.sessions where user_id=${uid}`;
      out.senha = novaSenha;
      dest = { nome, login: r.login, email: str(body.email ?? (r.email || '')).trim() };
    }
    if (!ativo) await t`delete from nc.sessions where user_id=${uid}`;
    await nextRev(t);
  });
  if (dest && novaSenha) out.email = await enviarSenha(dest.nome, dest.login, dest.email, novaSenha, false);
  return out;
});

route('POST', '/api/me/senha', async ({ user, body }) => {
  if (!(await checkPw(str(body.atual ?? ''), user.senha))) throw new ApiError(422, 'Senha atual incorreta.');
  validatePw(body.nova);
  if (body.nova === body.atual) throw new ApiError(422, 'A nova senha deve ser diferente da atual.');
  await sql`update nc.users set senha=${await hashPw(String(body.nova))},trocar_senha=false where id=${user.id}`;
  return { ok: true };
});

route('GET', '/api/backup', async ({ user }) => {
  requireAdmin(user);
  const anx: Record<string, Any[]> = {};
  for (const a of await sql`select * from nc.anexos order by criado_em`) {
    (anx[a.nc_id] ||= []).push({ id: a.id, nome: a.nome, tipo: a.tipo, em: a.criado_em, por: a.por,
      data: `data:${a.tipo};base64,${Buffer.from(a.conteudo).toString('base64')}` });
  }
  const ncs = (await sql`select * from nc.ncs`).map((r: Any) => {
    const d = ncOut(r, {});
    d.anexos = anx[r.id] || [];
    return d;
  });
  const payload = JSON.stringify({ app: 'melting-nc', versao: 2, exportadoEm: nowIso(), cfg: await getCfg(sql), ncs });
  return new Raw(payload, 'application/json', { 'Content-Disposition': `attachment; filename="backup-melting-nc_${today()}.json"` });
});

route('POST', '/api/import', async ({ user, body }) => {
  requireAdmin(user);
  if (body.app !== 'melting-nc' || !Array.isArray(body.ncs)) throw new ApiError(422, 'Arquivo não é um backup deste sistema.');
  let nOk = 0;
  await tx(async t => {
    if (isObj(body.cfg)) {
      const cfg = await getCfg(t);
      for (const k of ['setores', 'tipos', 'origens', 'disposicoes', 'responsaveis']) {
        if (Array.isArray(body.cfg[k])) cfg[k] = [...new Set([...cfg[k], ...body.cfg[k].map((x: Any) => str(x))])];
      }
      await saveCfg(t, cfg);
    }
    for (const nc of body.ncs) {
      if (!isObj(nc) || !nc.id) continue;
      const ncId = cleanId(nc.id);
      const d = clean(nc);
      for (const k of ['historico', 'criadoPor', 'criadoPorId', 'createdAt', 'dataRegistro', 'encerramento']) if (k in nc) d[k] = nc[k];
      if (!Array.isArray(d.historico)) d.historico = [];
      d.historico.push({ data: nowIso(), usuario: user.nome, acao: 'Registro importado de backup' });
      const status = nc.status in STATUS_LABEL ? nc.status : 'aberta';
      let numero = str(nc.numero || '');
      const [clash] = await t`select id from nc.ncs where numero=${numero}`;
      if (!numero || (clash && clash.id !== ncId)) numero = await nextNumero(t, str(d.dataOcorrencia || today()).slice(0, 4));
      const [exists] = await t`select version from nc.ncs where id=${ncId}`;
      await writeNc(t, ncId, numero, status, exists ? exists.version + 1 : 1, d, !exists);
      for (const a of Array.isArray(nc.anexos) ? nc.anexos : []) {
        if (!isObj(a) || !a.data) continue;
        let tipo: string, raw: Uint8Array;
        try { [tipo, raw] = decodeDataUrl(a.data); } catch { continue; }
        if (!FILE_TYPES.has(tipo)) continue;
        const aid = cleanId(a.id || tokenHex(8));
        await t`insert into nc.anexos(id,nc_id,nome,tipo,tamanho,conteudo,criado_em,por)
          values(${aid},${ncId},${sliceCp(str(a.nome || 'arquivo'), 0, 200)},${tipo},${raw.length},${Buffer.from(raw)},
                 ${a.em || nowIso()},${a.por || user.nome})
          on conflict(id) do update set nc_id=excluded.nc_id, nome=excluded.nome, tipo=excluded.tipo, tamanho=excluded.tamanho,
            conteudo=excluded.conteudo, criado_em=excluded.criado_em, por=excluded.por`;
      }
      nOk += 1;
    }
  });
  return { ok: true, importadas: nOk };
});

// ---------------------------------------------------------------- HTTP
const ORIGIN = Deno.env.get('NC_ALLOWED_ORIGIN') || '*';

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const allowed = ORIGIN.split(',').map(s => s.trim());
  return {
    'Access-Control-Allow-Origin': allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : allowed[0]),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-NC, X-NC-Token, Authorization, apikey',
    'Access-Control-Expose-Headers': 'Content-Disposition',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function respond(req: Request, body: Uint8Array | string, type: string, status = 200, extra: Record<string, string> = {}) {
  return new Response(body as BodyInit, {
    status,
    headers: { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...cors(req), ...extra },
  });
}

const json = (req: Request, obj: Any, status = 200) =>
  respond(req, JSON.stringify(obj), 'application/json; charset=utf-8', status, { 'Cache-Control': 'no-store' });

async function auth(token: string | null) {
  if (!token) return null;
  const now = Date.now() / 1000;
  const [r] = await sql`select u.*, s.expira from nc.sessions s join nc.users u on u.id=s.user_id
    where s.token=${token} and s.expira>${now} and u.ativo`;
  if (r && r.expira - now < SESSION_DAYS * 86400 / 2) {
    await sql`update nc.sessions set expira=${now + SESSION_DAYS * 86400} where token=${token}`;
  }
  return r || null;
}

function clientIp(req: Request, info?: Any) {
  const xff = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  return xff || req.headers.get('x-real-ip') || info?.remoteAddr?.hostname || 'desconhecido';
}

export async function handler(req: Request, info?: Any): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  const url = new URL(req.url);
  // No Supabase o caminho chega como /api/... (nome da função); em outros ambientes pode vir com /functions/v1 na frente.
  const i = url.pathname.indexOf('/api');
  const path = i >= 0 ? url.pathname.slice(i) : url.pathname;
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  try {
    for (const [m, rx, fn, isPublic] of ROUTES) {
      if (m !== method) continue;
      const mt = rx.exec(path);
      if (!mt) continue;
      if (method !== 'GET' && req.headers.get('X-NC') !== '1') throw new ApiError(403, 'Requisição recusada.');
      const token = req.headers.get('X-NC-Token') || (method === 'GET' ? url.searchParams.get('t') : null);
      const user = isPublic ? null : await auth(token);
      if (!isPublic && !user) throw new ApiError(401, 'Faça login para continuar.');
      let body: Any = {};
      if (method === 'POST' || method === 'PUT') {
        if (+(req.headers.get('Content-Length') || 0) > MAX_BODY) throw new ApiError(413, 'Requisição muito grande.');
        const raw = await req.text();
        if (raw.length > MAX_BODY) throw new ApiError(413, 'Requisição muito grande.');
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          throw new ApiError(400, 'JSON inválido.');
        }
        if (!isObj(body)) body = {};
      }
      const res = await fn({ req, user, body, q: url.searchParams, params: (mt.groups || {}) as Record<string, string>, token, ip: clientIp(req, info) });
      if (res instanceof Raw) return respond(req, res.body, res.type, 200, res.headers);
      return json(req, res);
    }
    throw new ApiError(404, 'Rota não encontrada.');
  } catch (e) {
    if (e instanceof ApiError) return json(req, { erro: e.msg, ...e.extra }, e.status);
    console.error(e);
    return json(req, { erro: 'Erro interno no servidor.' }, 500);
  }
}

Deno.serve(handler);
