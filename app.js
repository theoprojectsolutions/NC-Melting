/* =========================================================
   Melting · Gestão de Não Conformidades — cliente web
   Conversa com o servidor (server.py) pela API /api/*
   ========================================================= */
'use strict';

/* ---------- Constantes ---------- */
const STATUS = {
  aberta:      { label: 'Rascunho',                color: '#94a3b8' },
  analise:     { label: 'Em análise',              color: '#38bdf8' },
  acao:        { label: 'Ação em andamento',       color: '#a78bfa' },
  verificacao: { label: 'Verificação de eficácia', color: '#22d3ee' },
  autorizacao: { label: 'Aguardando autorização',  color: '#e879f9' },
  qualidade:   { label: 'Qualidade',               color: '#22d3ee' },
  encerrada:  { label: 'Encerrada',               color: '#34d399' },
  cancelada:   { label: 'Cancelada',               color: '#7d8ea3' },
};
// Plano de ação (5W2H) e verificação de eficácia estão desativados por enquanto (fluxo simplificado).
// Para reativar: true aqui e PLANO_ACAO = True no server.py.
const PLANO_ACAO = false;
const FLOW = PLANO_ACAO ? ['aberta', 'analise', 'acao', 'verificacao', 'autorizacao', 'qualidade', 'encerrada'] : ['aberta', 'analise', 'autorizacao', 'qualidade', 'encerrada'];
const STATUS_USADOS = k => FLOW.includes(k) || k === 'cancelada';
const SEV = {
  baixa:   { label: 'Baixa',   color: '#34d399', w: 1 },
  media:   { label: 'Média',   color: '#f5a524', w: 2 },
  alta:    { label: 'Alta',    color: '#fb7a3c', w: 3 },
  critica: { label: 'Crítica', color: '#f43f5e', w: 4, legado: true },   // fora de uso: só para exibir NCs antigas
};
/** Severidades que podem ser escolhidas (Baixa, Média, Alta). */
const SEV_OPCOES = Object.entries(SEV).filter(([, s]) => !s.legado);
const PERFIS = {
  admin:       { label: 'Administrador', color: '#f472b6', desc: 'Vê todo o cenário (todas as NCs). Único que cancela e exclui NCs. Usuários, configurações e backup.' },
  gestor:      { label: 'Gestor',        color: '#fbbf24', desc: 'Abaixo do administrador: vê todo o cenário (todas as NCs, usuários e configurações), mas só consulta — não altera usuários, configurações nem cancela NCs.' },
  qualidade:   { label: 'Qualidade',     color: '#3aa8ff', desc: 'Vê todas as NCs e o Painel completo. Avança, retorna e reabre etapas. Encerra só se for gestor da área (ou se o setor não tiver gestor).' },
  colaborador: { label: 'Colaborador',   color: '#93a7c0', desc: 'Vê só as suas NCs e pendências (as que registrou, pelas quais é responsável ou das áreas em que é gestor). O Painel mostra apenas os dados delas.' },
};
const DISPOSICOES = ['Retrabalho', 'Reparo', 'Uso como está (concessão do cliente)', 'Reclassificação', 'Sucata', 'Devolução ao fornecedor', 'Não aplicável'];
const ACAO_TIPOS = ['Corretiva', 'Preventiva', 'Melhoria'];
const ACAO_STATUS = ['Pendente', 'Em andamento', 'Concluída'];
const ACAO_COLOR = { 'Pendente': '#f5a524', 'Em andamento': '#38bdf8', 'Concluída': '#34d399' };
const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const POLL_MS = 15000;

/* ---------- Ícones ---------- */
const I = {
  dash: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  kanban: '<rect x="3" y="3" width="5" height="18" rx="1.5"/><rect x="10" y="3" width="5" height="12" rx="1.5"/><rect x="17" y="3" width="4" height="8" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  arrow: '<path d="M5 12h14M13 5l7 7-7 7"/>',
  back: '<path d="M19 12H5M11 19l-7-7 7-7"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkc: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  rotate: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
  more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  money: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  sheet: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8M10 9h-2"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 21v-4h6v4M8.5 7h1M14.5 7h1M8.5 11h1M14.5 11h1"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M15 8l2 2"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
};
const icon = (n, c = '') => `<svg class="ic ${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${I[n] || ''}</svg>`;

/* ---------- API ---------- */
// Na internet (Supabase) o endereço do servidor vem de config.js (window.NC_API) e a sessão vai no cabeçalho
// X-NC-Token. Sem config.js (rede interna com server.py) continua usando /api no mesmo endereço, com cookie.
const API_BASE = (window.NC_API || '').replace(/\/+$/, '') || '/api';
const REMOTE = !!window.NC_API;
const TOKEN_KEY = 'nc-token';
if (REMOTE) { const ob = document.querySelector('.offline-bar'); if (ob) ob.textContent = 'Sem conexão com o servidor. Verifique sua internet. Tentando reconectar…'; }
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const setToken = t => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* sem armazenamento */ } };
/** Endereço para links diretos (anexos, backup): o token vai na URL, pois <img>/<a> não enviam cabeçalhos. */
const apiURL = path => API_BASE + path + (REMOTE && getToken() ? (path.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(getToken()) : '');
async function api(method, path, body) {
  let r;
  try {
    const headers = { 'Content-Type': 'application/json', 'X-NC': '1' };
    if (REMOTE && getToken()) headers['X-NC-Token'] = getToken();
    r = await fetch(API_BASE + path, {
      method, credentials: REMOTE ? 'omit' : 'same-origin', headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    setOnline(false);
    throw Object.assign(new Error('Sem conexão com o servidor. Verifique a rede.'), { status: 0 });
  }
  setOnline(true);
  let data = null;
  try { data = await r.json(); } catch { /* sem corpo */ }
  if (REMOTE && data?.token) setToken(data.token);
  if (REMOTE && (path === '/logout' || (r.status === 401 && !['/login', '/setup'].includes(path)))) setToken('');
  if (r.status === 401 && !['/login', '/status', '/setup'].includes(path)) {
    if (S.me) { S.me = null; stopPolling(); showAuth('login', 'Sua sessão expirou. Entre novamente.'); }
  }
  if (!r.ok) throw Object.assign(new Error(data?.erro || `Erro ${r.status}`), { status: r.status, data });
  return data;
}
function setOnline(on) {
  if (S.online === on) return;
  S.online = on;
  document.body.classList.toggle('offline', !on);
}

/* ---------- Estado ---------- */
const emptyFilters = () => ({ q: '', status: '', sev: '', setor: '', tipo: '', de: '', ate: '', only: '' });
const S = {
  me: null, cfg: null, ncs: [], pessoas: [], rev: 0, online: true,
  draft: null, isNew: false, dirty: false, skip: false, lastHash: '', remoteChanged: false,
  filters: emptyFilters(), sort: { k: 'numero', dir: -1 }, pollTimer: null, users: [],
};

/* ---------- Utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const isoOf = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const todayISO = () => isoOf(new Date());
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return isoOf(d); };
/** Prazo padrão: 1 dia útil após a abertura (sexta → segunda; sábado/domingo → segunda/terça). */
const proxDiaUtil = iso => { const d = new Date(iso + 'T12:00'); do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); return isoOf(d); };
const nowISO = () => new Date().toISOString();
const fmtD = iso => { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const fmtDT = iso => { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
const dayDiff = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 864e5);
const money = v => (+v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const isOpen = n => n.status !== 'encerrada' && n.status !== 'cancelada';
const isOverdue = n => isOpen(n) && !!n.prazo && n.prazo < todayISO();
const norm = s => String(s || '').trim().toLowerCase();
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const setPath = (o, p, v) => {
  const ks = p.split('.'); let a = o;
  ks.slice(0, -1).forEach((k, i) => { if (a[k] == null) a[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[k]; });
  a[ks[ks.length - 1]] = v;
};
// Valores em reais no padrão brasileiro: ponto = milhar, vírgula = decimal ("4.820,00").
// O valor é guardado como número com ponto decimal ("4820.00").
const moneyIn = v => (v === '' || v == null || isNaN(+v)) ? '' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function parseMoney(s) {
  s = String(s || '').replace(/[^\d.,]/g, '');
  if (!s) return '';
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.').replace(/,/g, '');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');   // 4.820 → 4820
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\.(?=.*\.)/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? '' : n.toFixed(2);
}
document.addEventListener('focusout', e => {   // ao sair do campo, mostra "4.820,00"
  const el = e.target;
  if (el.dataset && el.dataset.money) el.value = moneyIn(parseMoney(el.value));
});
const custoLogistico = n => n.custoLogHouve === 'sim' ? (+n.custoLog || 0) : 0;
const custoTotal = n => (+n.custo || 0) + custoLogistico(n) + (n.acoes || []).reduce((s, a) => s + (+a.custo || 0), 0);
const anexoURL = id => apiURL(`/anexos/${encodeURIComponent(id)}`);
const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

/* ---------- Permissões (o servidor também valida) ---------- */
const isAdmin = () => S.me?.perfil === 'admin';
/** Administrador ou Gestor: enxergam todo o cenário (o Gestor apenas consulta). */
const veTudo = () => ['admin', 'gestor'].includes(S.me?.perfil);
/** Enxergam todas as NCs (Painel completo): Administrador, Gestor e Qualidade. O Colaborador vê só as dele. */
const veTodasNCs = () => ['admin', 'gestor', 'qualidade'].includes(S.me?.perfil);
const isGestao = () => ['admin', 'qualidade'].includes(S.me?.perfil);
/* Hierarquia dos setores (Configurações): gestor da área + equipe */
const gestorSetor = setor => (S.cfg?.setorGestor || {})[setor] || '';
const equipeSetor = setor => (S.cfg?.setorUsuarios || {})[setor] || [];
const souGestor = n => !!gestorSetor(n.setor) && norm(gestorSetor(n.setor)) === norm(S.me?.nome);
const doSetor = n => souGestor(n) || equipeSetor(n.setor).some(x => norm(x) === norm(S.me?.nome));
/** Autorização (sair de "Aguardando autorização"): gestor da área; o administrador sempre; sem gestor definido, a Qualidade. */
function podeEncerrar(n) {
  if (isAdmin()) return true;
  return gestorSetor(n.setor) ? souGestor(n) : isGestao();
}
/** Encerramento (sair da etapa "Qualidade"): somente perfis Qualidade, Gestor ou Administrador. */
const podeFinalizar = () => ['admin', 'gestor', 'qualidade'].includes(S.me?.perfil);
function isMine(n) {
  const nm = norm(S.me?.nome);
  if (n.status === 'aberta') return n.criadoPorId === S.me?.id;   // rascunho é pendência de quem abriu
  return norm(n.responsavel) === nm || souGestor(n) || (n.acoes || []).some(a => norm(a.responsavel) === nm && a.status !== 'Concluída');
}
function canEdit(n) {
  if (isGestao()) return true;
  if (!isOpen(n)) return false;
  if (n.status === 'qualidade' && podeFinalizar()) return true;
  if (n.status === 'aberta') return n.criadoPorId === S.me.id;   // rascunho: só quem abriu
  if (n.criadoPorId === S.me.id) return true;
  const nm = norm(S.me.nome);
  return norm(n.responsavel) === nm || doSetor(n) || (n.acoes || []).some(a => norm(a.responsavel) === nm);
}

const pillStatus = k => `<span class="pill" style="--c:${STATUS[k].color}"><i></i>${STATUS[k].label}</span>`;
const pillSev = k => SEV[k] ? `<span class="sev" style="--c:${SEV[k].color}">${SEV[k].label}</span>` : '';
const pillPerfil = k => `<span class="pill" style="--c:${PERFIS[k]?.color || '#93a7c0'}"><i></i>${PERFIS[k]?.label || k}</span>`;
/** Selo visual de prazo para os cartões do Kanban: no prazo, vencendo ou atrasada. */
function prazoBadge(n) {
  if (n.status === 'cancelada' || !n.prazo) return '';
  let cls, ic, txt, tip;
  if (!isOpen(n)) {
    const fim = n.encerramento?.data || '';
    const atras = fim && fim > n.prazo;
    [cls, ic, txt, tip] = atras ? ['late', 'alert', 'Fora do prazo', `Encerrada em ${fmtD(fim)}, prazo era ${fmtD(n.prazo)}`]
      : ['ok', 'checkc', 'No prazo', `Encerrada dentro do prazo (${fmtD(n.prazo)})`];
  } else {
    const d = dayDiff(todayISO(), n.prazo);
    [cls, ic, txt, tip] = d < 0 ? ['late', 'alert', 'Atrasada', `Prazo vencido há ${-d} dia${d === -1 ? '' : 's'} (${fmtD(n.prazo)})`]
      : d <= 7 ? ['soon', 'clock', d === 0 ? 'Vence hoje' : 'Vencendo', `Vence ${d === 0 ? 'hoje' : `em ${d} dia${d === 1 ? '' : 's'}`} (${fmtD(n.prazo)})`]
      : ['ok', 'checkc', 'No prazo', `Prazo: ${fmtD(n.prazo)}`];
  }
  return `<span class="kprazo ${cls}" title="${tip}">${icon(ic)}${txt}</span>`;
}
function dueLabel(n) {
  if (!n.prazo) return '<span class="due ok">Sem prazo</span>';
  if (!isOpen(n)) return `<span class="due ok">${fmtD(n.prazo)}</span>`;
  const d = dayDiff(todayISO(), n.prazo);
  if (d < 0) return `<span class="due late">Vencida há ${-d} dia${d === -1 ? '' : 's'}</span>`;
  if (d === 0) return '<span class="due soon">Vence hoje</span>';
  if (d <= 7) return `<span class="due soon">Vence em ${d} dia${d === 1 ? '' : 's'}</span>`;
  return `<span class="due ok">${fmtD(n.prazo)}</span>`;
}
function acaoProg(n) {
  const a = n.acoes || []; if (!a.length) return PLANO_ACAO ? '<span class="prog">—</span>' : '';
  const c = a.filter(x => x.status === 'Concluída').length;
  return `<span class="prog"><span class="bar"><i style="width:${c / a.length * 100}%"></i></span>${c}/${a.length}</span>`;
}
function responsaveisList() {
  const set = new Set([...S.pessoas, ...(S.cfg.responsaveis || [])]);
  S.ncs.forEach(n => [n.responsavel, ...(n.acoes || []).map(a => a.responsavel)].forEach(x => x && set.add(x)));
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
const initials = nome => (nome || '?').split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();

/* ---------- Toast & Modais ---------- */
function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = icon(type === 'err' ? 'alert' : type === 'info' ? 'rotate' : 'checkc') + `<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), 3600);
  setTimeout(() => t.remove(), 4000);
}
function modal({ title, body, actions, wide }) {
  return new Promise(res => {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-back"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><h3>${title}</h3><div class="modal-body">${body}</div><div class="modal-actions">${actions.map((a, i) => `<button class="btn ${a.cls || 'btn-ghost'}" data-i="${i}">${a.label}</button>`).join('')}</div></div></div>`;
    const close = v => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); res(v); };
    const onKey = e => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    $$('[data-i]', root).forEach(b => b.onclick = () => close(actions[+b.dataset.i].value));
    $('.modal-back', root).onclick = e => { if (e.target.classList.contains('modal-back')) close(null); };
    const last = $$('[data-i]', root).pop(); last && last.focus();
  });
}
const confirmBox = (title, body, ok = 'Confirmar', danger = false) =>
  modal({ title, body, actions: [{ label: 'Cancelar', value: false }, { label: ok, value: true, cls: danger ? 'btn-danger' : 'btn-primary' }] });
/** Modal com formulário. `submit(values)` deve devolver uma mensagem de erro ou nada; o modal fecha quando não houver erro. */
function formModal(title, fieldsHTML, okLabel, submit, { intro = '', cancel = true } = {}) {
  return new Promise(res => {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-back"><form class="modal" id="mf" novalidate autocomplete="off"><h3>${title}</h3>
      <div class="modal-body">${intro}<div class="grid mgrid">${fieldsHTML}</div><p class="form-err" id="mf-err"></p></div>
      <div class="modal-actions">${cancel ? '<button type="button" class="btn btn-ghost" data-x>Cancelar</button>' : ''}<button class="btn btn-primary" id="mf-ok">${okLabel}</button></div></form></div>`;
    const f = $('#mf');
    const close = v => { root.innerHTML = ''; res(v); };
    $('[data-x]', root)?.addEventListener('click', () => close(null));
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f));
      $$('input[type=checkbox]', f).forEach(c => { v[c.name] = c.checked; });
      const btn = $('#mf-ok'); btn.disabled = true;
      let result;
      try { result = await submit(v); } catch (err) { result = { erro: err.message }; }
      btn.disabled = false;
      if (result && result.erro) { $('#mf-err').textContent = result.erro; return; }
      close(result || v);
    });
    $('input:not([type=hidden]),select', f)?.focus();
  });
}
const inp = (label, name, { type = 'text', value = '', req, cls = '', ph = '', opts, auto } = {}) => opts
  ? `<label class="fld ${cls}"><span>${label}${req ? ' <b>*</b>' : ''}</span><select name="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`
  : `<label class="fld ${cls}"><span>${label}${req ? ' <b>*</b>' : ''}</span><input type="${type}" name="${name}" value="${esc(value)}" placeholder="${esc(ph)}" ${auto ? `autocomplete="${auto}"` : ''}></label>`;

/* =========================================================
   LOGIN / CONFIGURAÇÃO INICIAL
   ========================================================= */
function showAuth(mode, msg = '') {
  document.body.classList.add('auth-mode');
  const box = $('#auth');
  const setup = mode === 'setup';
  box.innerHTML = `
    <div class="auth-card">
      <div class="auth-brand"><div class="brand-logo"><img src="assets/logo-melting-escuro.png" alt="Melting 70 anos"></div><div class="brand-tag">Gestão de <b>Não Conformidades</b></div></div>
      <form id="auth-form" class="auth-form" novalidate>
        ${setup ? `<h2>Configuração inicial</h2><p class="muted">Crie a conta do <b>administrador</b>. Depois você poderá cadastrar os demais usuários.</p>
          ${inp('Seu nome completo', 'nome', { req: true, ph: 'Ex.: Rafael Rigobello', auto: 'name' })}
          ${inp('Usuário de acesso', 'login', { req: true, ph: 'Ex.: rafael', auto: 'username' })}
          ${inp('Senha', 'senha', { type: 'password', req: true, ph: 'Mínimo 6 caracteres', auto: 'new-password' })}
          ${inp('Confirme a senha', 'senha2', { type: 'password', req: true, auto: 'new-password' })}`
        : `<h2>Entrar</h2><p class="muted">Use o usuário e a senha fornecidos pelo administrador.</p>
          ${inp('Usuário', 'login', { req: true, auto: 'username' })}
          ${inp('Senha', 'senha', { type: 'password', req: true, auto: 'current-password' })}`}
        <p class="form-err" id="auth-err">${esc(msg)}</p>
        <button class="btn btn-primary btn-block" id="auth-btn">${setup ? 'Criar administrador e entrar' : 'Entrar'} ${icon('arrow')}</button>
      </form>
      <p class="auth-foot">#qualidade<b>melting</b></p>
    </div>`;
  const f = $('#auth-form');
  $('input', f).focus();
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const err = $('#auth-err'); err.textContent = '';
    if (setup && v.senha !== v.senha2) { err.textContent = 'As senhas não conferem.'; return; }
    const btn = $('#auth-btn'); btn.disabled = true;
    try {
      await api('POST', setup ? '/setup' : '/login', v);
      await boot();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  });
}
function hideAuth() { document.body.classList.remove('auth-mode'); $('#auth').innerHTML = ''; }

async function boot() {
  const b = await api('GET', '/bootstrap');
  S.me = b.me; S.cfg = b.cfg; S.ncs = b.ncs; S.pessoas = b.pessoas; S.rev = b.rev;
  hideAuth(); renderNav(); renderUser(); renderOnline(b.online); renderNotif(b.notif); startPolling();
  if (S.me.trocarSenha) await changePassword(true);
  if (!location.hash || location.hash === '#') location.hash = '#/painel'; else { S.lastHash = ''; route(); }
}
async function logout() {
  if (S.dirty && !(await confirmBox('Sair', 'Há alterações não salvas. Sair mesmo assim?', 'Sair', true))) return;
  try { await api('POST', '/logout', {}); } catch { /* ignora */ }
  S.me = null; S.dirty = false; S.draft = null; stopPolling();
  showAuth('login');
}
async function changePassword(forced = false) {
  const r = await formModal(forced ? 'Defina uma nova senha' : 'Alterar minha senha',
    `${inp('Senha atual', 'atual', { type: 'password', req: true, cls: 'c2', auto: 'current-password' })}
     ${inp('Nova senha', 'nova', { type: 'password', req: true, ph: 'Mínimo 6 caracteres', auto: 'new-password' })}
     ${inp('Confirme a nova senha', 'nova2', { type: 'password', req: true, auto: 'new-password' })}`,
    'Salvar senha',
    async v => {
      if (v.nova !== v.nova2) return { erro: 'As senhas não conferem.' };
      await api('POST', '/me/senha', { atual: v.atual, nova: v.nova });
    },
    { intro: forced ? '<p style="margin-bottom:14px">Por segurança, troque a senha provisória que você recebeu do administrador.</p>' : '', cancel: !forced });
  if (r) { S.me.trocarSenha = false; toast('Senha alterada'); }
}

/* =========================================================
   NAVEGAÇÃO
   ========================================================= */
function renderNav() {
  const open = S.ncs.filter(isOpen).length, over = S.ncs.filter(isOverdue).length;
  const mine = S.ncs.filter(n => isOpen(n) && isMine(n)).length;
  $('#nav').innerHTML = `
    <div class="nav-label">Gestão</div>
    <a href="#/painel" data-m="painel">${icon('dash')}Painel</a>
    <a href="#/ncs" data-m="ncs">${icon('list')}Não conformidades ${over ? `<span class="badge" title="Vencidas">${over}</span>` : open ? `<span class="badge info">${open}</span>` : ''}</a>
    <a href="#/minhas" data-m="minhas">${icon('user')}Minhas pendências ${mine ? `<span class="badge info">${mine}</span>` : ''}</a>
    <a href="#/kanban" data-m="kanban">${icon('kanban')}Kanban de gestão</a>
    <a href="#/historicos" data-m="historicos">${icon('clock')}Históricos ${(() => { const h = S.ncs.filter(ehHistorico).length; return h ? `<span class="badge info">${h}</span>` : ''; })()}</a>    ${veTudo() ? `<div class="nav-label">Administração${isAdmin() ? '' : ' <small>(consulta)</small>'}</div>
    <a href="#/usuarios" data-m="usuarios">${icon('users')}Usuários</a>
    <a href="#/config" data-m="config">${icon('cog')}Configurações</a>` : ''}`;
  markNav();
}
function markNav() {
  const h = location.hash || '';
  const key = h.startsWith('#/nova') ? 'nova' : h.startsWith('#/nc/') ? 'ncs' : h.replace('#/', '');
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.m === key));
}
function renderUser() {
  $('#sidebar-user').innerHTML = `<div class="avatar">${esc(initials(S.me.nome))}</div>
    <div class="who"><b>${esc(S.me.nome)}</b><small>${PERFIS[S.me.perfil]?.label}</small></div>
    <button class="icon-btn theme-btn" data-act="toggle-theme" title="Alternar tema claro / escuro" aria-label="Alternar tema claro / escuro">
      <svg class="ic t-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
      <svg class="ic t-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
    </button>
    <button class="icon-btn" data-act="change-pw" title="Alterar minha senha">${icon('key')}</button>
    <button class="icon-btn" data-act="logout" title="Sair">${icon('logout')}</button>`;
}
/** Tema claro/escuro: escolha salva neste navegador. */
function toggleTheme() {
  const light = document.documentElement.dataset.theme !== 'light';
  if (light) document.documentElement.dataset.theme = 'light'; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('nc-tema', light ? 'light' : 'dark'); } catch { /* ignora */ }
  $('meta[name="theme-color"]')?.setAttribute('content', light ? '#eef3f9' : '#060a12');
  toast(light ? 'Tema claro ativado' : 'Tema escuro ativado', 'info');
}
const setTitle = t => { $('#page-title').textContent = t; document.title = `${t} · Melting NC`; };

function route() {
  if (!S.me) return;
  const h = location.hash || '#/painel';
  if (S.skip) { S.skip = false; return; }
  if (S.dirty && h !== S.lastHash) {
    if (!confirm('Existem alterações não salvas. Deseja descartá-las?')) { S.skip = true; location.hash = S.lastHash; return; }
    S.dirty = false;
  }
  S.lastHash = h; S.draft = null; S.remoteChanged = false;
  document.body.classList.remove('nav-open');
  $('#modal-root').innerHTML = '';
  markNav();
  window.scrollTo(0, 0);
  let m;
  if (h === '#/painel') renderDashboard();
  else if (h === '#/ncs') renderList();
  else if (h === '#/minhas') { S.filters = { ...emptyFilters(), only: 'minhas', status: 'abertas' }; renderList('Minhas pendências'); }
  else if (h === '#/kanban') renderKanban();
  else if (h === '#/historicos') renderHistoricos();
  else if (h === '#/nova') renderEditor(null);
  else if ((m = h.match(/^#\/nc\/(.+)$/))) renderEditor(decodeURIComponent(m[1]));
  else if (h === '#/usuarios' && veTudo()) renderUsers();
  else if (h === '#/config' && veTudo()) renderConfig();
  else location.hash = '#/painel';
}
function gotoList(k, v) {
  S.filters = emptyFilters();
  if (k) S.filters[k] = v;
  if (location.hash === '#/ncs') renderList(); else location.hash = '#/ncs';
}

/* ---------- Usuários online (canto superior direito) ---------- */
function renderOnline(list) {
  const box = $('#online'); if (!box || !Array.isArray(list)) return;
  S.online = list;
  box.innerHTML = `<button class="online-btn" data-act="online-toggle" aria-label="Usuários online agora">
      <span class="online-n"><span class="online-dot"></span><b>${list.length}</b> online</span></button>
    <div class="online-pop" id="online-pop"><div class="online-h">${icon('users')} Online agora <small>${list.length}</small></div>
      ${list.map(u => `<div class="online-row"><span class="online-dot"></span><span class="avatar sm" style="--pc:${PERFIS[u.perfil]?.color || '#93a7c0'}">${esc(initials(u.nome))}</span><div><b>${esc(u.nome)}${u.id === S.me?.id ? ' <small>(você)</small>' : ''}</b><small>${PERFIS[u.perfil]?.label || u.perfil}</small></div></div>`).join('')}
      <p class="online-note">Ativos nos últimos 90 segundos.</p></div>`;
}
document.addEventListener('click', e => { if (!e.target.closest('#online')) $('#online')?.classList.remove('open'); });

/* ---------- Notificações (sino + pop-up) ---------- */
const BELL = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
const notifVistoKey = () => 'nc-notif-visto-' + (S.me?.id || '');
function renderNotif(n) {
  const box = $('#notif'); if (!box || !n) return;
  S.notif = n;
  const lista = n.lista || [];
  box.innerHTML = `<button class="notif-btn${n.naoLidas ? ' tem' : ''}" data-act="notif-toggle" aria-label="Notificações" title="Notificações">${BELL}${n.naoLidas ? `<span class="notif-badge">${n.naoLidas > 99 ? '99+' : n.naoLidas}</span>` : ''}</button>
    <div class="notif-pop" id="notif-pop">
      <div class="notif-h">${BELL} Notificações <small>${n.naoLidas ? `${n.naoLidas} não lida(s)` : 'tudo lido'}</small>
        ${n.naoLidas ? '<button class="linkbtn" data-act="notif-todas">Marcar todas como lidas</button>' : ''}</div>
      ${lista.length ? lista.map(x => `<button class="notif-row${x.lida ? '' : ' nova'}" data-act="notif-open" data-id="${x.id}" data-nc="${esc(x.nc_id || '')}">
          <span class="notif-dot"></span><div><b>${esc(x.titulo)}</b>${x.texto ? `<span>${esc(x.texto)}</span>` : ''}<small>${fmtDT(x.data)}${x.de ? ' · por ' + esc(x.de) : ''}</small></div></button>`).join('')
        : '<div class="empty-mini">Nenhuma notificação ainda.</div>'}
    </div>`;
  // pop-up para o que chegou desde a última vez que este usuário viu
  let visto = 0; try { visto = +localStorage.getItem(notifVistoKey()) || 0; } catch { /* ignora */ }
  const novas = lista.filter(x => !x.lida && x.id > visto);
  if (novas.length) {
    try { localStorage.setItem(notifVistoKey(), String(Math.max(...lista.map(x => x.id)))); } catch { /* ignora */ }
    notifPopup(novas);
  }
}
function notifPopup(novas) {
  const x = novas[0];
  $('#notif-popup')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div class="notif-popup" id="notif-popup" role="alertdialog" aria-live="assertive">
    <div class="np-ico">${BELL}</div>
    <div class="np-txt"><small>Nova notificação${novas.length > 1 ? ` · +${novas.length - 1} outra(s)` : ''}</small><b>${esc(x.titulo)}</b>${x.texto ? `<span>${esc(x.texto)}</span>` : ''}${x.de ? `<em>Enviada por ${esc(x.de)}</em>` : ''}</div>
    <div class="np-acts">${x.nc_id ? `<button class="btn btn-primary btn-sm" data-act="notif-open" data-id="${x.id}" data-nc="${esc(x.nc_id)}">Abrir NC</button>` : ''}<button class="btn btn-ghost btn-sm" data-act="notif-fechar">Depois</button></div>
  </div>`);
  try {   // alerta do Windows, quando o navegador permitir (localhost ou HTTPS)
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(x.titulo, { body: x.texto || '', tag: 'nc-' + x.id });
  } catch { /* ignora */ }
}
async function notifMarcar(body) {
  try { renderNotif(await api('POST', '/notificacoes/lidas', body)); } catch (e) { toast(e.message, 'err'); }
}
document.addEventListener('click', e => { if (!e.target.closest('#notif')) $('#notif')?.classList.remove('open'); });

/* ---------- Sincronização (outros usuários) ---------- */
function startPolling() { stopPolling(); S.pollTimer = setInterval(poll, POLL_MS); }
function stopPolling() { clearInterval(S.pollTimer); S.pollTimer = null; }
async function poll() {
  if (!S.me || document.hidden || S.polling) return;
  S.polling = true;
  try { applySync(await api('GET', `/ncs?since=${S.rev}`)); } catch { /* offline: tenta de novo */ } finally { S.polling = false; }
}
function upsert(n) {
  const i = S.ncs.findIndex(x => x.id === n.id);
  if (i >= 0) S.ncs[i] = n; else S.ncs.push(n);
}
function applySync(r) {
  S.cfg = r.cfg; S.pessoas = r.pessoas;
  renderOnline(r.online); renderNotif(r.notif);
  const ids = new Set(r.ids);
  // NC que passou a ser visível para mim sem ter sido alterada (ex.: virei gestor da área): busca a lista completa
  if (S.rev && r.ids.some(id => !S.ncs.some(n => n.id === id) && !r.changed.some(n => n.id === id))) { S.rev = 0; setTimeout(poll, 0); return; }
  let changed = r.changed.filter(n => { const o = S.ncs.find(x => x.id === n.id); return !o || o.updatedAt !== n.updatedAt; });
  changed.forEach(upsert);
  const removed = S.ncs.filter(n => !ids.has(n.id));
  if (removed.length) S.ncs = S.ncs.filter(n => ids.has(n.id));
  S.rev = r.rev;
  if (!changed.length && !removed.length) return;
  renderNav();
  const h = location.hash;
  if (S.draft && !S.isNew) {
    if (removed.some(n => n.id === S.draft.id)) { S.dirty = false; toast('Esta NC foi excluída ou não está mais disponível para você', 'err'); location.hash = '#/ncs'; return; }
    const srv = changed.find(n => n.id === S.draft.id);
    if (!srv) return;
    if (srv.version !== S.draft.version) {
      if (!S.dirty) { loadDraft(srv); toast(`${srv.numero} foi atualizada por ${lastUser(srv)}`, 'info'); }
      else { S.remoteChanged = true; showRemoteBanner(srv); }
    } else {
      S.draft.anexos = srv.anexos; S.draft.historico = srv.historico;
      const ab = $('#anexos-body'); if (ab) ab.innerHTML = anexosHTML();
      renderLog();
    }
    return;
  }
  if (h === '#/painel') renderDashboard();
  else if (h === '#/ncs' || h === '#/minhas') { if ($('#tbody')) renderTable(); }
  else if (h === '#/kanban' && !$('.kcard.dragging')) { if ($('#kboard')) drawBoard(); else renderKanban(); }
  else if (h === '#/historicos') { if ($('#hist-body')) drawHistoricos(); else renderHistoricos(); }
}
const lastUser = n => (n.historico || []).slice(-1)[0]?.usuario || 'outro usuário';
function showRemoteBanner(srv) {
  let b = $('#remote-banner');
  if (!b) { b = document.createElement('div'); b.id = 'remote-banner'; b.className = 'banner warn'; $('.ed-head')?.after(b); }
  b.innerHTML = `${icon('alert')}<div><b>${esc(lastUser(srv))}</b> alterou esta NC às ${fmtDT(srv.updatedAt).split(' ')[1]} enquanto você editava. Ao salvar você poderá escolher qual versão manter.</div><button class="btn btn-sm btn-ghost" data-act="reload-draft">Ver versão atual</button>`;
}

/* =========================================================
   PAINEL
   ========================================================= */
function emptyHTML() {
  return `<div class="card empty">
    <div class="ring">${icon('inbox')}</div>
    <h2>Nenhuma não conformidade registrada</h2>
    <p>Registre a primeira NC para começar a acompanhar contenção, análise de causa, plano de ação 5W2H e verificação de eficácia.${isAdmin() ? ' Se quiser conhecer o sistema antes, carregue dados de exemplo (você pode excluí-los depois).' : ''}</p>
    <div class="row">
      <a class="btn btn-primary" href="#/nova">${icon('plus')} Registrar NC</a>
      ${isAdmin() ? `<button class="btn btn-ghost" data-act="load-demo">${icon('db')} Carregar dados de exemplo</button>` : ''}
    </div>
  </div>`;
}

function renderDashboard() {
  setTitle('Painel');
  const v = $('#view'), ncs = S.ncs;
  if (!ncs.length) { v.innerHTML = emptyHTML(); return; }
  const t = todayISO(), ym = t.slice(0, 7), yy = t.slice(0, 4);
  // Filtro de período do Painel: mês (AAAA-MM, padrão = mês vigente), ano inteiro (AAAA) ou todo o período ('*')
  if (S.dashPer == null) S.dashPer = ym;
  const per = S.dashPer, noPer = s => per === '*' || (s || '').startsWith(per);
  const perLabel = per === '*' ? 'todo o período' : per.length === 4 ? `ano ${per}` : `${MES[+per.slice(5) - 1]}/${per.slice(0, 4)}`;
  const perOpts = [['*', 'Todo o período']];
  [...new Set([yy, ...ncs.map(n => (n.dataOcorrencia || '').slice(0, 4)).filter(Boolean)])].sort().reverse()
    .forEach(y => perOpts.push([y, `Ano ${y} (inteiro)`]));
  for (let i = 0; i < 24; i++) { const d = new Date(+yy, +ym.slice(5) - 1 - i, 1); const k = isoOf(d).slice(0, 7); perOpts.push([k, `${MES[d.getMonth()]}/${d.getFullYear()}${k === ym ? ' (mês atual)' : ''}`]); }
  if (!perOpts.some(o => o[0] === per)) perOpts.push([per, perLabel]);
  const ncsPer = ncs.filter(n => noPer(n.dataOcorrencia));
  const open = ncs.filter(isOpen), over = open.filter(isOverdue);
  const closed = ncs.filter(n => n.status === 'encerrada');
  const closedMonth = closed.filter(n => noPer(n.encerramento?.data)).length;
  const newMonth = ncsPer.length;
  const times = closed.filter(n => n.encerramento?.data).map(n => dayDiff(n.dataRegistro || n.dataOcorrencia, n.encerramento.data));
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
  const pend = open.reduce((s, n) => s + (n.acoes || []).filter(a => a.status !== 'Concluída').length, 0);
  const ncsAno = ncsPer.filter(n => n.status !== 'cancelada');   // canceladas não entram no custo
  const custoAno = ncsAno.reduce((s, n) => s + custoTotal(n), 0);
  const custoSetor = {};
  ncsAno.forEach(n => { const c = custoTotal(n); if (c > 0) custoSetor[n.setor || 'Sem setor'] = (custoSetor[n.setor || 'Sem setor'] || 0) + c; });
  // Padrão dos rankings do Painel: quantidade (ou valor) + selo com o percentual, em colunas alinhadas
  const qp = (v, total, c, val) => { const p = total ? Math.round(v / total * 100) : 0;
    return `<span class="ov${v ? '' : ' zero'}">${val || `<b>${v}</b> NC${v === 1 ? '' : 's'}`}</span><span class="op${v ? '' : ' zero'}" style="--pc:${c}">${p}%</span>`; };
  const custoSetorRows = Object.entries(custoSetor).sort((a, b) => b[1] - a[1])
    .map(([l, v]) => ({ l, v, t: qp(v, custoAno, '#f5a524', `<b>${money(v)}</b>`), tip: `${money(v)} · ${Math.round(v / custoAno * 100)}%`, k: 'setor', fv: l, c: '#f5a524' }));
  const reinc = ncs.filter(n => n.reincidente === 'sim').length;
  const first = (S.me.nome || '').split(' ')[0];
  const mine = open.filter(isMine).sort((a, b) => (a.prazo || '9').localeCompare(b.prazo || '9'));

  const kpi = (label, val, ic, c, sub, k, fv) => `<button class="card kpi" style="${c ? `--c:${c}` : ''}" data-act="goto-filter" data-k="${k || ''}" data-v="${fv || ''}">
      <div class="kpi-top">${label}${icon(ic)}</div><div class="kpi-v">${val}</div><div class="kpi-s">${sub || '&nbsp;'}</div></button>`;

  const statusRows = Object.entries(STATUS).filter(([k]) => STATUS_USADOS(k) || ncs.some(n => n.status === k)).map(([k, s]) => ({ l: s.label, v: ncs.filter(n => n.status === k).length, c: s.color, k: 'status', fv: k }));
  const sevRows = Object.entries(SEV).filter(([k, s]) => !s.legado || open.some(n => n.severidade === k)).map(([k, s]) => ({ l: s.label, v: open.filter(n => n.severidade === k).length, c: s.color }));
  // ranking completo (sem corte); empate em ordem alfabética
  const countBy = (field, list) => { const m = {}; list.forEach(n => { const x = n[field] || 'Não informado'; m[x] = (m[x] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')); };
  const pctN = v => Math.round(v / ncsPer.length * 100);
  const setorRows = countBy('setor', ncsPer).map(([l, v]) => ({ l, v, t: qp(v, ncsPer.length, '#3aa8ff'), tip: `${v} NC(s) · ${pctN(v)}%`, k: 'setor', fv: l }));
  const respRows = countBy('responsavel', ncsPer).map(([l, v]) => ({ l, v, t: qp(v, ncsPer.length, '#a78bfa'), tip: `${v} NC(s) · ${pctN(v)}%`, k: 'q', fv: l, c: '#a78bfa' }));
  // Indicador por origem: todas as origens configuradas (mesmo sem NC) + as antigas que ainda aparecem no período
  const origCont = Object.fromEntries((S.cfg.origens || []).map(o => [o, 0]));
  ncsPer.forEach(n => { const o = n.origem || 'Não informado'; origCont[o] = (origCont[o] || 0) + 1; });
  const origRows = Object.entries(origCont).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
    .map(([l, v]) => ({ l, v, t: qp(v, ncsPer.length, '#22c3a6'), tip: `${v} NC(s) · ${ncsPer.length ? pctN(v) : 0}%`, k: 'q', fv: l, c: '#22c3a6' }));
  const origTop = origRows.find(r => r.v > 0);
  const cliTodos = countBy('cliente', ncsPer.map(n => ({ cliente: (n.cliente || '').toUpperCase() || 'Não informado' })));
  const cliRows = cliTodos.slice(0, 20)   // ranking dos 20 principais clientes / fornecedores
    .map(([l, v]) => ({ l, v, t: qp(v, ncsPer.length, '#f5a524'), tip: `${v} NC(s) · ${pctN(v)}%`, k: 'q', fv: l, c: '#f5a524' }));
  const att = open.filter(n => n.prazo && dayDiff(t, n.prazo) <= 7).sort((a, b) => a.prazo.localeCompare(b.prazo));
  const attRow = n => `<div class="att" data-act="open" data-id="${n.id}"><span class="num">${esc(n.numero)}</span><span class="tt">${esc(n.titulo)}</span><span class="who">${esc(n.responsavel || '—')}</span>${dueLabel(n)}</div>`;

  v.innerHTML = `
    <section class="card hero">
      <div>
        <p class="eyebrow">#qualidade<b>melting</b></p>
        <h2>Olá, ${esc(first)}!</h2>
        <p class="muted">Há <b style="color:var(--text)">${open.length}</b> não conformidade${open.length === 1 ? '' : 's'} em tratamento${over.length ? ` — <b class="txt-err">${over.length} com prazo vencido</b>` : ''}. ${mine.length ? `Você tem <b style="color:var(--glow2)">${mine.length}</b> pendência${mine.length === 1 ? '' : 's'}.` : ''}</p>
      </div>
      <label class="dash-per">${icon('calendar')}<span>Período</span>
        <select data-dash-per>${perOpts.map(([k, l]) => `<option value="${k}" ${k === per ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      </label>
    </section>
    <div class="kpis">
      ${kpi('Em tratamento', open.length, 'list', '', `${ncs.length} no total`, 'status', 'abertas')}
      ${kpi('Prazo vencido', over.length, 'alert', over.length ? 'var(--err)' : '', 'precisam de atenção', 'only', 'vencidas')}
      ${kpi('Registradas no período', newMonth, 'plus', '', perLabel)}
      ${kpi('Encerradas no período', closedMonth, 'checkc', 'var(--ok)', `${perLabel} · ${closed.length} no total`, 'status', 'encerrada')}
      ${kpi('Tempo médio p/ encerrar', avg == null ? '—' : `${avg}<small style="font-size:14px;font-weight:600"> dias</small>`, 'clock', '', 'do registro ao encerramento')}
      ${kpi('Ações pendentes', pend, 'target', pend ? 'var(--warn)' : '', `${reinc} NC${reinc === 1 ? '' : 's'} reincidente${reinc === 1 ? '' : 's'}`)}
    </div>
    <div class="dash-grid">
      <div class="card span-2"><h3>Tendência — 12 meses<span id="tend-range" class="tend-range"></span></h3>${monthlyChart()}</div>
      <div class="card"><h3>Severidade <small>NCs em tratamento</small></h3>${donut(sevRows, open.length)}</div>
      <div class="card span-2"><h3>${icon('user')} Minhas pendências <small>NCs ou ações sob sua responsabilidade</small></h3>
        ${mine.length ? `<div class="att-list">${mine.map(attRow).join('')}</div>` : '<div class="empty-mini">Nada pendente com você. 👏</div>'}
      </div>
      <div class="card"><h3>Por status</h3>${hbars(statusRows)}</div>
      <div class="card span-2"><h3>${icon('alert')} Atenção aos prazos <small>vencidas ou vencendo em 7 dias</small></h3>
        ${att.length ? `<div class="att-list">${att.map(attRow).join('')}</div>` : '<div class="empty-mini">Nenhuma NC vencida ou próxima do prazo.</div>'}
      </div>
      <div class="card qp qp-money"><h3>${icon('money')} Custo da não qualidade <small>${perLabel}</small></h3>
        <div class="big-money">${money(custoAno)}</div>
        <p class="muted" style="font-size:12.5px;margin-top:6px">Soma dos prejuízos informados nas NCs do período (retrabalho, transporte, mão de obra etc.). NCs canceladas não entram.</p>
        <div class="custo-setor"><h4>Por setor</h4>${custoSetorRows.length ? hbars(custoSetorRows) : '<div class="empty-mini">Nenhum prejuízo informado no período.</div>'}</div>
      </div>
      <div class="card span-3 dash-origem qp"><h3>${icon('target')} Por origem <small>como as NCs foram detectadas · ${perLabel}</small></h3>
        <div class="origem-wrap">
          <div class="origem-tot"><div class="big-money">${ncsPer.length}</div><span>NC${ncsPer.length === 1 ? '' : 's'} no período (100%)</span>
            ${origTop ? `<p class="muted">Principal origem: <b style="color:var(--text)">${esc(origTop.l)}</b> — ${Math.round(origTop.v / ncsPer.length * 100)}% das NCs.</p>` : ''}</div>
          <div>${hbars(origRows)}<div class="origem-soma"><span>Total no período</span><span class="hb-v"><span class="ov"><b>${ncsPer.length}</b> NC${ncsPer.length === 1 ? '' : 's'}</span><span class="op tot">100%</span></span></div></div>
        </div></div>
      <div class="card dash-pct qp"><h3>Por setor <small>${perLabel} · ${ncsPer.length} NC${ncsPer.length === 1 ? '' : 's'}</small></h3>${setorRows.length ? hbars(setorRows) : '<div class="empty-mini">Nenhuma NC no período.</div>'}</div>
      <div class="card dash-pct qp"><h3>Por responsável <small>${perLabel} · ${ncsPer.length} NC${ncsPer.length === 1 ? '' : 's'}</small></h3>${respRows.length ? hbars(respRows) : '<div class="empty-mini">Nenhuma NC no período.</div>'}</div>
      <div class="card dash-pct qp"><h3>Top 20 clientes / fornecedores <small>${perLabel} · ${ncsPer.length} NC${ncsPer.length === 1 ? '' : 's'}</small></h3>${cliRows.length ? hbars(cliRows) : '<div class="empty-mini">Nenhuma NC no período.</div>'}${cliTodos.length > 20 ? `<p class="muted" style="font-size:11.5px;margin-top:8px">+ ${cliTodos.length - 20} outro(s) com menos NCs — veja a lista completa em Não conformidades.</p>` : ''}</div>
    </div>`;
}

function hbars(rows) {
  if (!rows.length) return '<div class="empty-mini">Sem dados</div>';
  const max = Math.max(1, ...rows.map(r => r.v));
  return `<div class="hbars">${rows.map(r => `<button class="hbar" ${r.k ? `data-act="goto-filter" data-k="${r.k}" data-v="${esc(r.fv)}"` : ''} title="${esc(r.l)}: ${r.tip || (r.t ? money(r.v) : r.v)}">
    <span class="hb-l">${esc(r.l)}</span><span class="hb-t"><i style="width:${r.v / max * 100}%;--c:${r.c || '#1f7fd6'}"></i></span><span class="hb-v">${r.t || r.v}</span></button>`).join('')}</div>`;
}
function donut(rows, total) {
  let acc = 0;
  const segs = rows.filter(r => r.v).map(r => { const a = acc / total * 360; acc += r.v; return `${r.c} ${a}deg ${acc / total * 360}deg`; }).join(',');
  return `<div class="donut-wrap"><div class="donut" style="background:${total ? `conic-gradient(${segs})` : 'var(--surface3)'}"><div><b>${total}</b><span>em aberto</span></div></div>
    <ul class="legend">${rows.map(r => `<li><i style="background:${r.c}"></i>${r.l}<b>${r.v}</b></li>`).join('')}</ul></div>`;
}
// Tendência: 12 meses a partir de Out/2026 (início do sistema). Depois de Set/2027 a janela passa a "rolar" com os últimos 12 meses.
const TENDENCIA_INICIO = new Date(2026, 9, 1);
function monthlyChart() {
  const months = []; const d = new Date();
  const ult12 = new Date(d.getFullYear(), d.getMonth() - 11, 1);
  const ini = ult12 > TENDENCIA_INICIO ? ult12 : TENDENCIA_INICIO;
  for (let i = 0; i < 12; i++) { const m = new Date(ini.getFullYear(), ini.getMonth() + i, 1); months.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`); }
  const lbl = m => `${MES[+m.slice(5) - 1]}/${m.slice(2, 4)}`;
  setTimeout(() => { const r = $('#tend-range'); if (r) r.textContent = `${lbl(months[0])} a ${lbl(months[11])}`; });
  const reg = months.map(m => S.ncs.filter(n => (n.dataOcorrencia || '').startsWith(m)).length);
  const enc = months.map(m => S.ncs.filter(n => n.status === 'encerrada' && (n.encerramento?.data || '').startsWith(m)).length);
  const max = Math.max(1, ...reg, ...enc);
  return `<div class="legend-inline"><span><i style="background:#3aa8ff"></i>Registradas</span><span><i style="background:#10b981"></i>Encerradas</span></div>
  <div class="vbars">${months.map((m, i) => `<div class="vb" title="${MES[+m.slice(5) - 1]}/${m.slice(2, 4)}: ${reg[i]} registradas, ${enc[i]} encerradas">
    <div class="vb-bars"><i style="height:${reg[i] / max * 85}%" data-v="${reg[i] || ''}"></i><i class="ok" style="height:${enc[i] / max * 85}%" data-v="${enc[i] || ''}"></i></div>
    <span>${MES[+m.slice(5) - 1]}${i === 0 || m.endsWith('-01') ? `<small>/${m.slice(2, 4)}</small>` : ''}</span></div>`).join('')}</div>`;
}

/* =========================================================
   LISTA
   ========================================================= */
function filtered() {
  const f = S.filters, q = f.q.trim().toLowerCase();
  const list = S.ncs.filter(n => {
    if (q && ![n.numero, n.titulo, n.descricao, n.cliente, n.os, n.item, n.responsavel, n.setor, n.origem, n.criadoPor].join(' ').toLowerCase().includes(q)) return false;
    if (f.status === 'abertas') { if (!isOpen(n)) return false; }
    else if (f.status && n.status !== f.status) return false;
    if (f.sev && n.severidade !== f.sev) return false;
    if (f.setor && n.setor !== f.setor) return false;
    if (f.de && (n.dataOcorrencia || '') < f.de) return false;
    if (f.ate && (n.dataOcorrencia || '') > f.ate) return false;
    if (f.only === 'vencidas' && !isOverdue(n)) return false;
    if (f.only === 'minhas' && !isMine(n)) return false;
    return true;
  });
  const { k, dir } = S.sort;
  const val = n => k === 'severidade' ? SEV[n.severidade]?.w || 0
    : k === 'status' ? (n.status === 'cancelada' ? 9 : FLOW.indexOf(n.status))
    : k === 'prazo' ? (n.prazo || '9999') : String(n[k] || '').toLowerCase();
  return list.sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * dir; });
}

function renderList(title = 'Não conformidades') {
  setTitle(title);
  const v = $('#view');
  if (!S.ncs.length) { v.innerHTML = emptyHTML(); return; }
  const f = S.filters;
  const opt = (arr, cur) => arr.map(o => { const [val, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${val === cur ? 'selected' : ''}>${esc(l)}</option>`; }).join('');
  const setores = [...new Set([...S.cfg.setores, ...S.ncs.map(n => n.setor).filter(Boolean)])];
  v.innerHTML = `
    <div class="toolbar">
      <label class="search">${icon('search')}<input type="search" data-filter="q" value="${esc(f.q)}" placeholder="Buscar por número, título, cliente, OS, responsável…"></label>
      <select data-filter="status"><option value="">Todos os status</option>${opt([['abertas', 'Em tratamento (não encerradas)'], ...Object.entries(STATUS).filter(([k]) => STATUS_USADOS(k)).map(([k, s]) => [k, s.label])], f.status)}</select>
      <select data-filter="sev"><option value="">Toda severidade</option>${opt(SEV_OPCOES.map(([k, s]) => [k, s.label]), f.sev)}</select>
      <select data-filter="setor"><option value="">Todos os setores</option>${opt(setores, f.setor)}</select>
      <input type="date" data-filter="de" value="${f.de}" title="Ocorrência de">
      <input type="date" data-filter="ate" value="${f.ate}" title="Ocorrência até">
      <button class="btn btn-ghost" data-act="export-csv" title="Exportar a lista filtrada para Excel">${icon('sheet')}<span>Exportar Excel</span></button>
    </div>
    <div class="result-info" id="result-info"></div>
    <div class="card table-wrap"><table class="tbl"><thead id="thead"></thead><tbody id="tbody"></tbody></table></div>`;
  renderTable();
}

function renderTable() {
  const rows = filtered();
  const f = S.filters;
  const active = [];
  if (f.only === 'vencidas') active.push(['only', 'Somente vencidas']);
  if (f.only === 'minhas') active.push(['only', 'Sob minha responsabilidade']);
  if (f.status) active.push(['status', f.status === 'abertas' ? 'Em tratamento' : STATUS[f.status]?.label]);
  if (f.sev) active.push(['sev', 'Severidade: ' + SEV[f.sev].label]);
  if (f.setor) active.push(['setor', f.setor]);
  if (f.de || f.ate) active.push(['periodo', `Período: ${f.de ? fmtD(f.de) : '…'} a ${f.ate ? fmtD(f.ate) : '…'}`]);
  $('#result-info').innerHTML = `<span><b style="color:var(--text)">${rows.length}</b> de ${S.ncs.length} registro${S.ncs.length === 1 ? '' : 's'}</span>
    ${active.map(([k, l]) => `<span class="chip">${esc(l)}<button data-act="rm-filter" data-k="${k}" aria-label="Remover filtro">${icon('x')}</button></span>`).join('')}
    ${active.length || f.q ? '<button class="linkbtn" data-act="clear-filters">Limpar filtros</button>' : ''}`;
  const cols = [['numero', 'Nº'], ['dataOcorrencia', 'Ocorrência'], ['titulo', 'Não conformidade'], ['setor', 'Setor'], ['severidade', 'Severidade'], ['responsavel', 'Responsável'], ['prazo', 'Prazo'], ...(PLANO_ACAO ? [['acoes', 'Ações']] : []), ['status', 'Status']];
  $('#thead').innerHTML = `<tr>${cols.map(([k, l]) => `<th data-act="sort" data-k="${k}">${l}${S.sort.k === k ? `<span class="arr">${S.sort.dir > 0 ? '↑' : '↓'}</span>` : ''}</th>`).join('')}</tr>`;
  $('#tbody').innerHTML = rows.length ? rows.map(n => `
    <tr data-act="open" data-id="${n.id}">
      <td class="num">${esc(n.numero)}</td>
      <td class="hide-m">${fmtD(n.dataOcorrencia)}</td>
      <td class="tt">${esc(n.titulo)}<small>${esc(n.cliente || '—')}</small></td>
      <td class="hide-m"><span class="tag">${esc(n.setor || '—')}</span></td>
      <td>${pillSev(n.severidade)}</td>
      <td class="hide-m">${esc(n.responsavel || '—')}</td>
      <td>${dueLabel(n)}</td>
      ${PLANO_ACAO ? `<td class="hide-m">${acaoProg(n)}</td>` : ''}
      <td>${pillStatus(n.status)}</td>
    </tr>`).join('') : `<tr><td colspan="9"><div class="empty-mini" style="margin:10px">Nenhum registro encontrado com esses filtros.</div></td></tr>`;
}

/* =========================================================
   KANBAN
   ========================================================= */
// Virada do dia com o Kanban aberto: redesenha para mover as encerradas de ontem para "Históricos".
let kanbanDia = '';
setInterval(() => { if (kanbanDia && kanbanDia !== todayISO() && $('.kanban') && !$('.kcard.dragging')) drawBoard(); }, 5 * 60 * 1000);

/* Filtros gerais do Kanban (ficam salvos neste navegador) */
const KF_VAZIO = () => ({ q: '', resp: '', setor: '', cliente: '', sev: '', de: '', ate: '', prazo: '' });
const kfLoad = () => { try { return { ...KF_VAZIO(), ...JSON.parse(localStorage.getItem('nc-kf') || '{}') }; } catch { return KF_VAZIO(); } };
const kfSave = () => { try { localStorage.setItem('nc-kf', JSON.stringify(S.kf)); } catch { } };
function kfMatch(n) {
  const f = S.kf;
  if (f.q) {
    const t = norm([n.numero, n.titulo, n.cliente, n.os, n.item, n.responsavel, n.setor, n.descricao].join(' '));
    if (!norm(f.q).split(/\s+/).every(p => t.includes(p))) return false;
  }
  if (f.resp && norm(n.responsavel) !== norm(f.resp)) return false;
  if (f.setor && n.setor !== f.setor) return false;
  if (f.cliente && (n.cliente || '').toUpperCase() !== f.cliente) return false;
  if (f.sev && n.severidade !== f.sev) return false;
  if (f.de && (n.dataOcorrencia || '') < f.de) return false;
  if (f.ate && (n.dataOcorrencia || '') > f.ate) return false;
  if (f.prazo) {
    if (!isOpen(n) || !n.prazo) return false;
    const d = dayDiff(todayISO(), n.prazo);
    if (f.prazo === 'atrasadas' && d >= 0) return false;
    if (f.prazo === 'vencendo' && (d < 0 || d > 7)) return false;
    if (f.prazo === 'noprazo' && d < 0) return false;
  }
  return true;
}
const kfAtivos = () => Object.values(S.kf).filter(Boolean).length;
/* Históricos: NCs encerradas em dias anteriores (saem do Kanban no dia seguinte ao encerramento) */
const fimEnc = n => (n.encerramento?.data || n.updatedAt || '').slice(0, 10);
const ehHistorico = n => n.status === 'encerrada' && !!fimEnc(n) && fimEnc(n) < todayISO();
function renderHistoricos() {
  setTitle('Históricos');
  const v = $('#view');
  const f = S.hf ||= { q: '', setor: '', resp: '', cliente: '', de: '', ate: '', ord: 'desc' };
  const todos = S.ncs.filter(ehHistorico);
  const uniq = a => [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y, 'pt-BR'));
  const opt = (arr, cur) => arr.map(o => `<option value="${esc(o)}" ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('');
  v.innerHTML = `<p class="muted" style="margin-bottom:12px;font-size:13px">NCs <b>encerradas</b> em dias anteriores. Elas saem do Kanban no dia seguinte ao encerramento e ficam guardadas aqui para consulta.</p>
    <div class="kfilters card">
      <label class="search kf-q">${icon('search')}<input type="search" data-hf="q" value="${esc(f.q)}" placeholder="Buscar nº, título, cliente, item…"></label>
      <label class="kf"><span>Setor</span><select data-hf="setor"><option value="">Todos</option>${opt(uniq(todos.map(n => n.setor)), f.setor)}</select></label>
      <label class="kf"><span>Responsável</span><select data-hf="resp"><option value="">Todos</option>${opt(uniq(todos.map(n => n.responsavel)), f.resp)}</select></label>
      <label class="kf"><span>Cliente / Fornec.</span><select data-hf="cliente"><option value="">Todos</option>${opt(uniq(todos.map(n => (n.cliente || '').toUpperCase())), f.cliente)}</select></label>
      <label class="kf"><span>Encerrada de</span><input type="date" data-hf="de" value="${esc(f.de)}"></label>
      <label class="kf"><span>até</span><input type="date" data-hf="ate" value="${esc(f.ate)}"></label>
      <div class="kf-end"><span id="hf-info" class="muted"></span><button class="btn btn-ghost btn-sm" data-act="hist-csv">${icon('sheet')}<span>Exportar Excel</span></button></div>
    </div>
    <div id="hist-body"></div>`;
  drawHistoricos();
}
function drawHistoricos() {
  const box = $('#hist-body'); if (!box) return;
  const f = S.hf, q = norm(f.q);
  const list = S.ncs.filter(ehHistorico).filter(n =>
    (!q || norm([n.numero, n.titulo, n.cliente, n.item, n.os, n.responsavel, n.setor].join(' ')).includes(q)) &&
    (!f.setor || n.setor === f.setor) && (!f.resp || n.responsavel === f.resp) && (!f.cliente || (n.cliente || '').toUpperCase() === f.cliente) &&
    (!f.de || fimEnc(n) >= f.de) && (!f.ate || fimEnc(n) <= f.ate))
    .sort((a, b) => (fimEnc(a) + a.numero).localeCompare(fimEnc(b) + b.numero) * (f.ord === 'asc' ? 1 : -1));
  S.histList = list;
  $('#hf-info').innerHTML = `<b>${list.length}</b> de ${S.ncs.filter(ehHistorico).length} NCs`;
  const noPrazo = n => !n.prazo ? '—' : fimEnc(n) <= n.prazo ? '<span class="txt-ok">No prazo</span>' : '<span class="txt-err">Fora do prazo</span>';
  box.innerHTML = `<div class="card table-wrap"><table class="tbl hist"><thead><tr>
      <th>Nº</th><th>Abertura</th><th class="th-sort" data-act="hist-ord" title="Ordenar pela data de encerramento">Encerramento ${f.ord === 'asc' ? '↑' : '↓'}</th>
      <th>Não conformidade</th><th>Setor</th><th>Responsável</th><th>Severidade</th><th>Prazo</th><th class="hide-m">Prejuízo total</th></tr></thead><tbody>
    ${list.map(n => `<tr data-act="open" data-id="${n.id}">
      <td class="num">${esc(n.numero)}</td><td>${fmtD(n.dataRegistro || n.dataOcorrencia)}</td><td>${fmtD(fimEnc(n))}<small>${esc(n.encerramento?.por || '')}</small></td>
      <td class="tt">${esc(n.titulo)}<small>${esc(n.cliente || '—')}</small></td><td><span class="tag">${esc(n.setor || '—')}</span></td>
      <td>${esc(n.responsavel || '—')}</td><td>${pillSev(n.severidade)}</td><td>${noPrazo(n)}</td><td class="hide-m">${money(custoTotal(n))}</td></tr>`).join('')
      || `<tr><td colspan="9"><div class="empty-mini">${S.ncs.some(ehHistorico) ? 'Nenhuma NC para esses filtros.' : 'Ainda não há NCs no histórico. Elas aparecem aqui a partir do dia seguinte ao encerramento.'}</div></td></tr>`}
    </tbody></table></div>`;
}
/* Ordenação de cada coluna pela data da NC (salva neste navegador): padrão → ↓ recentes → ↑ antigas → padrão */
function kSortGet() { if (!S.kSort) { try { S.kSort = JSON.parse(localStorage.getItem('nc-ksort') || '{}'); } catch { S.kSort = {}; } } return S.kSort; }
function kSortToggle(col) {
  const s = kSortGet(); s[col] = s[col] === 'desc' ? 'asc' : s[col] === 'asc' ? '' : 'desc';
  if (!s[col]) delete s[col];
  try { localStorage.setItem('nc-ksort', JSON.stringify(s)); } catch { /* ignora */ }
  drawBoard();
}

function renderKanban() {
  setTitle('Kanban de gestão');
  const v = $('#view');
  if (!S.ncs.length) { v.innerHTML = emptyHTML(); return; }
  S.kf = S.kf || kfLoad();
  const f = S.kf;
  const opt = (arr, cur) => arr.map(o => { const [val, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${val === cur ? 'selected' : ''}>${esc(l)}</option>`; }).join('');
  const uniq = a => [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y, 'pt-BR'));
  const resps = uniq([...S.ncs.map(n => n.responsavel), ...(veTodasNCs() ? S.pessoas : [])]);
  const setores = uniq([...S.cfg.setores, ...S.ncs.map(n => n.setor)]);
  const clientes = uniq(S.ncs.map(n => (n.cliente || '').toUpperCase()));
  v.innerHTML = `<p class="muted" style="margin-bottom:12px;font-size:13px">Arraste um cartão para mover a NC de etapa. O sistema confere os requisitos de cada etapa e as suas permissões. NCs encerradas vão para a aba <a class="linkbtn" href="#/historicos">Históricos</a> (menu lateral) no dia seguinte ao encerramento.${veTodasNCs() ? '' : ' Você está vendo <b>somente as suas NCs</b>.'}</p>
  <div class="kfilters card">
    <label class="search kf-q">${icon('search')}<input type="search" data-kf="q" value="${esc(f.q)}" placeholder="Buscar nº, título, cliente, item…"></label>
    <label class="kf"><span>Responsável</span><select data-kf="resp"><option value="">Todos</option>${opt(resps, f.resp)}</select></label>
    <label class="kf"><span>Setor</span><select data-kf="setor"><option value="">Todos</option>${opt(setores, f.setor)}</select></label>
    <label class="kf"><span>Cliente / Fornec.</span><select data-kf="cliente"><option value="">Todos</option>${opt(clientes, f.cliente)}</select></label>
    <label class="kf"><span>Severidade</span><select data-kf="sev"><option value="">Todas</option>${opt(SEV_OPCOES.map(([k, s]) => [k, s.label]), f.sev)}</select></label>
    <label class="kf"><span>Prazo</span><select data-kf="prazo"><option value="">Todos</option>${opt([['atrasadas', 'Atrasadas'], ['vencendo', 'Vencendo (7 dias)'], ['noprazo', 'No prazo']], f.prazo)}</select></label>
    <label class="kf"><span>Ocorrência de</span><input type="date" data-kf="de" value="${esc(f.de)}"></label>
    <label class="kf"><span>até</span><input type="date" data-kf="ate" value="${esc(f.ate)}"></label>
    <div class="kf-end"><span id="kf-info" class="muted"></span><button class="btn btn-ghost btn-sm" data-act="kf-clear" id="kf-clear">${icon('x')}<span>Limpar</span></button></div>
  </div>
  <div id="kboard"></div>`;
  drawBoard();
}

function drawBoard() {
  const box = $('#kboard'); if (!box) return;
  kanbanDia = todayISO();
  // NCs novas já nascem "Em análise": a coluna "Aberta" só aparece enquanto houver NC antiga nela
  const cols = [...FLOW, 'cancelada'].filter(k => k !== 'aberta' || S.ncs.some(n => n.status === 'aberta'));
  // "Históricos": NCs encerradas em dias anteriores saem da coluna Encerrada automaticamente no dia seguinte.
  const hoje = todayISO();
  const fimDe = n => (n.encerramento?.data || n.updatedAt || '').slice(0, 10);
  const doHistorico = n => n.status === 'encerrada' && !!fimDe(n) && fimDe(n) < hoje;
  const base = S.ncs.filter(kfMatch);
  const nf = kfAtivos();
  $('#kf-info').innerHTML = nf ? `<b>${base.length}</b> de ${S.ncs.length} NCs · ${nf} filtro${nf > 1 ? 's' : ''}` : `${S.ncs.length} NCs`;
  $('#kf-clear').hidden = !nf;
  box.innerHTML = `
  <div class="kanban">${cols.map(k => {
    const list = k === 'historico'
      ? base.filter(doHistorico).sort((a, b) => fimDe(b).localeCompare(fimDe(a)))
      : base.filter(n => n.status === k && !(k === 'encerrada' && doHistorico(n))).sort((a, b) => (SEV[b.severidade]?.w || 0) - (SEV[a.severidade]?.w || 0) || (a.prazo || '9').localeCompare(b.prazo || '9'));
    // ordenação pela data da NC (setinha no cabeçalho): ↓ mais recentes primeiro, ↑ mais antigas primeiro
    const ord = kSortGet()[k];
    if (ord) list.sort((a, b) => ((a.dataOcorrencia || '') + a.numero).localeCompare((b.dataOcorrencia || '') + b.numero) * (ord === 'asc' ? 1 : -1));
    const shown = k === 'encerrada' || k === 'cancelada' || k === 'historico' ? list.slice(0, 15) : list;
    const meta = k === 'historico' ? { label: 'Históricos', color: '#94a3b8' } : STATUS[k];
    return `<div class="kcol${k === 'historico' ? ' khist' : ''}" data-col="${k}">
      <div class="kcol-h" style="--c:${meta.color}">${meta.label}
        <button class="ksort${ord ? ' on' : ''}" data-act="ksort" data-col="${k}" title="${ord === 'desc' ? 'Data da NC: mais recentes primeiro (clique para inverter)' : ord === 'asc' ? 'Data da NC: mais antigas primeiro (clique para voltar ao padrão)' : 'Ordenar pela data da NC'}">${ord === 'asc' ? '↑' : ord === 'desc' ? '↓' : '⇅'}</button>
        <span>${list.length}</span></div>
      ${shown.map(n => `<div class="kcard" draggable="${canEdit(n)}" data-id="${n.id}" data-act="open" style="--sc:${SEV[n.severidade]?.color}">
        <div class="khead"><span class="num">${esc(n.numero)}</span>${prazoBadge(n)}</div>
        <div class="kcli${n.cliente ? '' : ' none'}" title="Cliente / Fornecedor">${icon('building')}<span>${esc(n.cliente ? n.cliente.toUpperCase() : 'Sem cliente / fornecedor')}</span></div>
        <span class="tt">${esc(n.titulo)}</span>
        <div class="meta">${pillSev(n.severidade)}${dueLabel(n)}</div>
        <div class="kresp" title="Responsável pelo tratamento"><span class="avatar sm">${esc(initials(n.responsavel || '?'))}</span><span><small>Resp.</small>${esc(n.responsavel || 'Não definido')}</span></div>
        ${(() => { const g = gestorSetor(n.setor); return `<div class="kresp kgest${g ? '' : ' none'}" title="Gestor da área (autoriza a NC)"><span class="avatar sm">${g ? esc(initials(g)) : '—'}</span><span><small>Gestor</small>${esc(g || 'Sem gestor definido')}</span></div>`; })()}
        <div class="meta kfoot"><span class="kdata" title="Data de abertura da NC${n.dataOcorrencia && n.dataOcorrencia !== (n.dataRegistro || '').slice(0, 10) ? ` · ocorrência em ${fmtD(n.dataOcorrencia)}` : ''}">${icon('calendar')}${fmtD(n.dataRegistro || n.dataOcorrencia)}</span>${acaoProg(n)}<span class="tag">${esc(n.setor || '—')}</span></div>
      </div>`).join('')}
      ${k === 'historico' && !list.length ? '<div class="kempty">NCs encerradas aparecem aqui a partir do dia seguinte ao encerramento.</div>' : ''}
      ${list.length > shown.length ? `<button class="linkbtn" data-act="goto-filter" data-k="status" data-v="${k === 'historico' ? 'encerrada' : k}">Ver todas (${list.length})</button>` : ''}
    </div>`;
  }).join('')}</div>`;
  let dragId = null;
  $$('.kcard[draggable=true]').forEach(c => {
    c.addEventListener('dragstart', e => { dragId = c.dataset.id; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    c.addEventListener('dragend', () => { c.classList.remove('dragging'); $$('.kcol').forEach(x => x.classList.remove('over')); });
  });
  $$('.kcol:not(.khist)').forEach(col => {
    col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', () => col.classList.remove('over'));
    col.addEventListener('drop', async e => {
      e.preventDefault(); col.classList.remove('over');
      const nc = S.ncs.find(n => n.id === dragId); if (!nc) return;
      if (await moveTo(nc, col.dataset.col)) drawBoard();
    });
  });
}

/* ---------- Regras do fluxo (espelho do servidor, para orientar o usuário) ---------- */
function missingFor(d, status = d.status) {
  const m = [];
  switch (status) {
    case 'aberta':
      break;   // quem abre só registra; a justificativa é do responsável, na etapa "Em análise"
    case 'qualidade':
      if (!(d.qualidadeAcao || '').trim()) m.push('Descreva a <b>ação da Qualidade</b> para resolver a não conformidade (seção Encerramento).');
      break;
    case 'analise':
      if (!(d.contencao?.descricao || '').trim()) m.push('Preencha a <b>justificativa do responsável</b> (seção 3).');
      if (!(d.causa?.causaRaiz || '').trim()) m.push('Informe a <b>causa raiz</b> (seção 4).');
      if (!PLANO_ACAO) break;
      if (!d.acoes?.length) m.push('Cadastre ao menos <b>uma ação</b> no plano de ação (seção 4).');
      else if (d.acoes.some(a => !(a.descricao || '').trim() || !(a.responsavel || '').trim() || !a.prazo)) m.push('Preencha <b>O quê, Quem e Quando</b> de todas as ações.');
      break;
    case 'acao':
      if ((d.acoes || []).some(a => a.status !== 'Concluída')) m.push('Todas as ações do plano precisam estar <b>concluídas</b>.');
      break;
    case 'verificacao':
      if (d.eficacia?.resultado !== 'eficaz') m.push('Registre a verificação de eficácia como <b>Eficaz</b> (seção 5).');
      if (!(d.eficacia?.evidencia || '').trim()) m.push('Descreva a <b>evidência</b> que comprova a eficácia.');
      break;
  }
  return m;
}
function baseInvalid(d) {
  const req = [['titulo', 'Título'], ['descricao', 'Descrição'], ['dataOcorrencia', 'Data da ocorrência'], ['setor', 'Setor responsável pela NC'], ['responsavel', 'Responsável'], ['severidade', 'Severidade'], ['cliente', 'Cliente / Fornecedor'], ['origem', 'Origem / como foi detectada']];
  const out = req.filter(([f]) => !String(getPath(d, f) || '').trim());
  if (!d.id && !d.custoLogHouve) out.push(['custoLogHouve', 'Houve custo logístico? (Sim ou Não)']);
  if (d.custoLogHouve === 'sim' && !(+d.custoLog > 0)) out.push(['custoLog', 'Valor do custo logístico']);
  // responsável precisa ser usuário ativo (exigido para NCs novas ou quando o responsável é trocado)
  const orig = d.id ? S.ncs.find(n => n.id === d.id) : null;
  if (d.responsavel && !S.pessoas.includes(d.responsavel) && (!orig || orig.responsavel !== d.responsavel)) out.push(['responsavel', 'Responsável (deve ser um usuário cadastrado)']);
  return out;
}
function showPendencias(err, ncId) {
  const list = err.data?.pendencias || [];
  return modal({
    title: 'Não é possível avançar',
    body: `<p>${esc(err.message)}</p>${list.length ? `<ul>${list.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`,
    actions: ncId && location.hash !== '#/nc/' + ncId ? [{ label: 'Fechar', value: false }, { label: 'Abrir NC', value: true, cls: 'btn-primary' }] : [{ label: 'Entendi', value: false, cls: 'btn-primary' }],
  }).then(go => { if (go) location.hash = '#/nc/' + ncId; });
}
/** Move uma NC para outra etapa (usado pelo Kanban e pelo cancelamento). */
async function moveTo(n, to, nota) {
  const from = n.status; if (from === to) return false;
  if (to === 'cancelada') {
    if (!isAdmin()) { toast('Somente o administrador pode cancelar uma NC.', 'err'); return false; }
    const motivo = await askText('Cancelar não conformidade', `Informe o motivo do cancelamento de <b>${esc(n.numero)}</b> (ex.: registro em duplicidade, não procede).`, 'Motivo do cancelamento');
    if (motivo == null) return false;
    nota = 'Motivo do cancelamento: ' + (motivo || 'não informado');
  } else if (from === 'cancelada' || FLOW.indexOf(to) < FLOW.indexOf(from)) {
    if (!(await confirmBox('Retornar etapa', `Mover <b>${esc(n.numero)}</b> de “${STATUS[from].label}” para “${STATUS[to].label}”?`, 'Mover'))) return false;
  } else if (to === 'encerrada') {
    if (!(await confirmBox('Encerrar não conformidade', `Confirma o encerramento de <b>${esc(n.numero)}</b>?`, 'Encerrar'))) return false;
  }
  try {
    const r = await api('PUT', '/ncs/' + n.id, { nc: { ...n, status: to }, version: n.version, nota });
    upsert(r.nc); renderNav();
    toast(`${n.numero} → ${STATUS[to].label}`);
    return true;
  } catch (e) {
    if (e.status === 422 && e.data?.pendencias) await showPendencias(e, n.id);
    else if (e.status === 409) { upsert(e.data.nc); toast('A NC tinha sido alterada por outro usuário. Tente novamente.', 'err'); if ($('#kboard')) drawBoard(); }
    else toast(e.message, 'err');
    return false;
  }
}
function askText(title, body, ph) {
  return new Promise(res => {
    let val = '';
    modal({ title, body: `${body}<textarea id="ask-txt" rows="3" style="margin-top:12px" placeholder="${esc(ph)}"></textarea>`, actions: [{ label: 'Voltar', value: false }, { label: 'Confirmar', value: true, cls: 'btn-danger' }] })
      .then(ok => res(ok ? val : null));
    const ta = $('#ask-txt'); ta.focus();
    ta.addEventListener('input', () => { val = ta.value.trim(); });
  });
}

/* =========================================================
   EDITOR (registro / tratamento da NC)
   ========================================================= */
function blankNC() {
  return {
    id: '', numero: '', titulo: '', descricao: '', dataOcorrencia: todayISO(),
    tipo: '', origem: '', setor: '', cliente: '', os: '', item: '', quantidade: '',
    severidade: 'media', detectadoPor: S.me.nome, responsavel: '', prazo: proxDiaUtil(todayISO()), custo: '', custoLogHouve: '', custoLog: '',
    reincidente: 'nao', ncRelacionada: '', status: 'aberta',
    contencao: { descricao: '', responsavel: '', data: '', disposicao: '' },
    causa: { porques: ['', '', '', '', ''], ishikawa: {}, causaRaiz: '' },
    acoes: [],
    eficacia: { resultado: '', data: '', responsavel: '', evidencia: '' },
    encerramento: { data: '', por: '', comentario: '' },
    anexos: [], historico: [],
  };
}
const blankAcao = () => ({ id: uid(), descricao: '', porque: '', onde: '', responsavel: '', prazo: '', como: '', custo: '', tipo: 'Corretiva', status: 'Pendente', conclusao: '', obs: '' });
function normalizeNC(d) {
  const b = blankNC();
  for (const k of ['contencao', 'causa', 'eficacia', 'encerramento']) d[k] = { ...b[k], ...(d[k] || {}) };
  d.causa.porques = [...(d.causa.porques || []), '', '', '', '', ''].slice(0, 5);
  d.causa.ishikawa = d.causa.ishikawa || {};
  d.acoes = d.acoes || []; d.anexos = d.anexos || []; d.historico = d.historico || [];
  return d;
}

function renderEditor(id) {
  const src = id ? S.ncs.find(n => n.id === id) : null;
  if (id && !src) { setTitle('Não encontrada'); $('#view').innerHTML = `<div class="card empty"><div class="ring">${icon('alert')}</div><h2>NC não encontrada</h2><p>O registro pode ter sido excluído.</p><a class="btn btn-primary" href="#/ncs">Ver lista</a></div>`; return; }
  S.isNew = !src;
  S.pendentes = [];   // anexos escolhidos antes de registrar a NC (enviados ao registrar)
  S.logFilter = { q: '', user: '', tipo: '' };
  loadDraft(src || blankNC(), false);
}
function loadDraft(n, keepScroll = true) {
  S.draft = normalizeNC(structuredClone(n));
  S.dirty = false; S.remoteChanged = false;
  const y = window.scrollY; drawEditor(); if (keepScroll) window.scrollTo(0, y);
}
const editable = () => S.isNew || (isOpen(S.draft) && canEdit(S.ncs.find(n => n.id === S.draft.id) || S.draft));

function fld(label, f, o = {}) {
  const { type = 'text', req, opts, list, ph = '', cls = '', rows = 3, hint, w2h, ro, help, upper } = o;
  const val = getPath(S.draft, f) ?? '';
  let el;
  if (type === 'textarea') el = `<textarea data-f="${f}" rows="${rows}" placeholder="${esc(ph)}">${esc(val)}</textarea>`;
  else if (type === 'money') el = `<div class="money-in"><i>R$</i><input type="text" data-f="${f}" data-money="1" value="${esc(moneyIn(val))}" placeholder="${esc(ph)}" inputmode="decimal" autocomplete="off"></div>`;
  else if (type === 'select') {
    const has = opts.some(x => (Array.isArray(x) ? x[0] : x) === val);
    el = `<select data-f="${f}"><option value="">Selecione…</option>${opts.map(x => { const [v, l] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}${val && !has ? `<option selected>${esc(val)}</option>` : ''}</select>`;
  } else el = `<input type="${type}" data-f="${f}" value="${esc(upper ? String(val).toUpperCase() : val)}" placeholder="${esc(ph)}" ${upper ? 'data-upper="1" autocapitalize="characters"' : ''} ${list ? `list="${list}"` : ''} ${ro ? 'readonly tabindex="-1"' : ''} ${type === 'number' ? 'step="0.01" min="0" inputmode="decimal"' : ''}>`;
  return `<label class="fld ${cls}" data-fld="${f}"><span>${w2h ? `<em class="w2h">${w2h}</em>` : ''}${label}${req ? ' <b>*</b>' : ''}${hint ? ` <span class="hint">${hint}</span>` : ''}</span>${el}${help ? `<small class="fld-help">${help}</small>` : ''}</label>`;
}
function segRadio(label, f, items, req) {
  const val = getPath(S.draft, f);
  return `<div class="fld" data-fld="${f}"><span>${label}${req ? ' <b>*</b>' : ''}</span><div class="seg">${items.map(([k, l, c]) =>
    `<label style="--c:${c}"><input type="radio" name="r-${f}" data-f="${f}" value="${k}" ${val === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>`;
}
const sec = (id, n, title, sub, body, right = '') =>
  `<section class="card sec" id="sec-${id}"><header class="sec-h"><span class="sec-n">${n}</span><div><h3>${title}</h3><p>${sub}</p></div>${right ? `<div class="right">${right}</div>` : ''}</header><div class="sec-b">${body}</div></section>`;

function drawEditor() {
  const d = S.draft, st = d.status, canE = editable();
  setTitle(S.isNew ? 'Registrar não conformidade' : d.numero);
  const toc = [['ident', 'Identificação'], ['anexos', 'Evidências / anexos'], ['cont', 'Justificativa'], ['causa', 'Análise de causa'], ...(PLANO_ACAO ? [['acoes', 'Plano de ação 5W2H'], ['efic', 'Eficácia']] : []), ['enc', 'Encerramento'], ['log', 'Histórico de alterações']];
  const nSec = id => toc.findIndex(t => t[0] === id) + 1;

  let banner = '';
  if (st === 'encerrada') banner = `<div class="banner ok">${icon('checkc')}<div>NC encerrada em <b>${fmtD(d.encerramento?.data)}</b> por ${esc(d.encerramento?.por || '—')}. Registro bloqueado para edição${isGestao() ? ' — use <b>Reabrir</b> se precisar alterar' : ''}.</div></div>`;
  else if (st === 'cancelada') banner = `<div class="banner mute">${icon('ban')}<div>NC cancelada. Registro bloqueado${isGestao() ? ' — use <b>Reabrir</b> para retomar o tratamento' : ''}.</div></div>`;
  else if (!canE) banner = `<div class="banner mute">${icon('lock')}<div>Você está <b>visualizando</b> esta NC. Podem editá-la: quem registrou (${esc(d.criadoPor || '—')}), o responsável (${esc(d.responsavel || '—')}), os responsáveis pelas ações e a Qualidade.</div></div>`;
  else if (!S.isNew && isOverdue(d)) banner = `<div class="banner warn">${icon('alert')}<div>Prazo de tratamento vencido em <b>${fmtD(d.prazo)}</b>. Atualize o andamento ou renegocie o prazo.</div></div>`;
  else if (st === 'autorizacao') { const g = gestorSetor(d.setor); banner = `<div class="banner info">${icon('lock')}<div><b>Aguardando autorização</b> de ${g ? esc(g) : 'gestão da área (setor sem gestor definido — Qualidade/Administrador)'}. ${podeEncerrar(d) ? 'Revise a NC e use <b>Autorizar e enviar à Qualidade</b> ou <b>Devolver para análise</b>.' : ''}</div></div>`; }
  else if (st === 'aberta' && !S.isNew) banner = `<div class="banner mute">${icon('edit')}<div><b>Rascunho</b> — só quem abriu (e Administrador, Gestor e Qualidade) vê esta NC. Complete os campos obrigatórios e clique em <b>Enviar para análise</b> para mandá-la ao responsável.</div></div>`;
  else if (st === 'qualidade') banner = `<div class="banner info">${icon('checkc')}<div><b>Etapa Qualidade:</b> autorizada pelo gestor da área. A Qualidade registra a <b>ação para resolver</b> o problema (seção Encerramento) e <b>encerra</b> a NC${podeFinalizar() ? '' : ' — perfis Qualidade, Gestor ou Administrador'}.</div></div>`;
  else if (!S.isNew) { const m = missingFor(d); if (m.length) banner = `<div class="banner info">${icon('target')}<div><b>Próximo passo:</b> ${m.join(' ')}</div></div>`; }

  $('#view').innerHTML = `
    <div class="ed-head">
      <a class="icon-btn" href="#/ncs" title="Voltar para a lista">${icon('back')}</a>
      <div class="ed-title">
        <div class="ed-num">${S.isNew ? 'Novo registro' : esc(d.numero)} ${S.isNew ? '' : pillStatus(st)} <span id="ed-sev">${pillSev(d.severidade)}</span></div>
        <h2 id="ed-h2">${esc(d.titulo) || 'Nova não conformidade'}</h2>
        ${S.isNew ? '<div class="ed-meta">Preencha a identificação e anexe as evidências. Use <b>Salvar rascunho</b> para terminar depois, ou <b>Enviar para análise</b> quando estiver completo — a NC vai para o responsável, que preenche a justificativa e a causa raiz.</div>' : `<div class="ed-meta">Registrada em ${fmtD(d.dataRegistro)} por ${esc(d.criadoPor || '—')} · Atualizada ${fmtDT(d.updatedAt)} por ${esc(lastUser(d))} · <button class="linkbtn" data-act="scroll" data-to="sec-log">${icon('clock')} Ver histórico (${(d.historico || []).length})</button></div>`}
      </div>
    </div>
    ${stepperHTML(d)}
    ${banner}
    <datalist id="dl-resp">${responsaveisList().map(r => `<option value="${esc(r)}">`).join('')}</datalist>
    <div class="ed-grid">
      <nav class="ed-toc">${toc.map(([id, l], i) => `<button data-act="scroll" data-to="sec-${id}"><i>${i + 1}</i>${l}</button>`).join('')}</nav>
      <div class="ed-sections"><fieldset class="lock" ${canE ? '' : 'disabled'}>
        ${secIdent()}
        ${sec('anexos', nSec('anexos'), 'Evidências e anexos', 'Fotos da peça/processo, nota fiscal, etiqueta, relatórios (imagens ou PDF) — já podem ser anexados na abertura.', `<div id="anexos-body">${anexosHTML()}</div>`)}
        ${secCont(nSec('cont'))}
        ${secCausa(nSec('causa'))}
        ${PLANO_ACAO ? sec('acoes', nSec('acoes'), 'Plano de ação (5W2H)', 'O quê, por quê, onde, quem, quando, como e quanto custa — para eliminar a causa raiz.', `<div id="acoes-body">${acoesHTML()}</div>`, `<span id="acoes-prog">${acaoProg(d)}</span>`) : ''}
        ${PLANO_ACAO ? secEfic() : ''}
        ${secEnc(nSec('enc'))}
      </fieldset>${secLog(nSec('log'))}</div>
    </div>
    <div class="actionbar" id="actionbar">${actionbarHTML()}</div>`;
  bindDrop();
}

function stepperHTML(d) {
  if (d.status === 'cancelada') return '';
  const ci = FLOW.indexOf(d.status), fin = d.status === 'encerrada';
  return `<ol class="card stepper">${FLOW.map((k, i) => `<li class="${i < ci || fin ? 'done' : i === ci ? 'current' : ''}"><span class="dot">${i < ci || fin ? icon('check') : i + 1}</span><span class="lbl">${STATUS[k].label}</span></li>`).join('')}</ol>`;
}

function secIdent() {
  const c = S.cfg;
  return sec('ident', 1, 'Identificação da não conformidade', 'O que aconteceu, onde, quando e qual a gravidade.', `
    <div class="grid">
      ${fld('Número', 'numero', { ph: 'Gerado ao registrar', ro: true })}
      ${fld('Cliente / Fornecedor', 'cliente', { req: true, ph: 'EX.: GRUPO SUZANO, AMBEV, PROCTER…', upper: true })}
      ${fld('Título (resumo da NC)', 'titulo', { req: true, cls: 'c2', ph: 'EX.: CORREIA DIVERGENTE, MANGUEIRA COM MELEJAMENTO…', upper: true })}
      ${fld('Data da ocorrência', 'dataOcorrencia', { type: 'date', req: true })}
      ${fld('Origem / como foi detectada', 'origem', { type: 'select', opts: c.origens, req: true, cls: 'c2' })}
      ${fld('Setor responsável pela NC', 'setor', { type: 'select', opts: c.setores, req: true })}
      <div class="c2">${segRadio('Severidade', 'severidade', [...SEV_OPCOES, ...(SEV[S.draft.severidade]?.legado ? [[S.draft.severidade, SEV[S.draft.severidade]]] : [])].map(([k, s]) => [k, s.label, s.color]), true)}</div>
      ${fld('Nº Pedido / NF / OC', 'os', { cls: 'c2', ph: 'Nº do pedido, nota fiscal ou ordem de compra' })}
      ${fld('Quantidade afetada', 'quantidade', { ph: 'Ex.: 3 peças' })}
      ${fld('Item / equipamento / peça', 'item', { cls: 'c2', ph: 'Ex.: Correia BC12A, mangueira sanitária, correia 390H…' })}
      ${fld('Prejuízo estimado', 'custo', { type: 'money', ph: '0,00', help: `<span id="custo-help">${custoHelp(S.draft.setor)}</span>` })}
      ${segRadio('Houve custo logístico?', 'custoLogHouve', [['nao', 'Não', '#7d8ea3'], ['sim', 'Sim', '#f5a524']], true)}
      <div id="custolog-fld">${custoLogField()}</div>
      <div class="c2 custolog-total" id="custo-total">${custoTotalInfo()}</div>
      ${fld('Descrição detalhada', 'descricao', { type: 'textarea', req: true, rows: 4, cls: 'c4', ph: 'Descreva a não conformidade: requisito não atendido, evidência objetiva, valores medidos x especificados…' })}
      ${fld('Detectado por', 'detectadoPor', { list: 'dl-resp' })}
      ${respField()}
      ${fld('Prazo para tratamento', 'prazo', { type: 'date', help: '1 dia útil após a abertura (sem fim de semana)' })}
      ${segRadio('Reincidente?', 'reincidente', [['nao', 'Não', '#7d8ea3'], ['sim', 'Sim', '#f43f5e']])}
      ${fld('NC relacionada (se reincidente)', 'ncRelacionada', { cls: 'c2', ph: 'Ex.: NC-2026-004' })}
      <div class="c2 gestor-area" id="gestor-area">${gestorAreaHTML()}</div>
    </div>`);
}
/** Destaque com o gestor da área do setor responsável (quem autoriza e encerra a NC). */
function gestorAreaHTML() {
  const d = S.draft, s = d.setor, g = s ? gestorSetor(s) : '';
  if (!s) return `<span class="ga-lbl">${icon('user')} Gestor da área</span><div class="ga-vazio">Escolha o setor responsável para ver o gestor.</div>`;
  if (!g) return `<span class="ga-lbl">${icon('user')} Gestor da área · ${esc(s)}</span><div class="ga-vazio">Setor sem gestor definido — o administrador define em <b>Configurações</b>.</div>`;
  return `<span class="ga-lbl">${icon('user')} Gestor da área · ${esc(s)}</span>
    <div class="ga-nome"><span class="avatar">${esc(initials(g))}</span><div><b>${esc(g)}</b><small>Autoriza e encerra esta NC</small></div></div>`;
}
const refreshGestorArea = () => { const e = $('#gestor-area'); if (e) e.innerHTML = gestorAreaHTML(); };
/** Custo logístico: o valor só é preenchido (e passa a ser obrigatório) quando "Houve custo logístico?" = Sim. */
function custoLogField() {
  const sim = S.draft.custoLogHouve === 'sim';
  return `<label class="fld${sim ? '' : ' fld-off'}" data-fld="custoLog"><span>Valor do custo logístico${sim ? ' <b>*</b>' : ''}</span>
    <div class="money-in"><i>R$</i><input type="text" data-f="custoLog" data-money="1" value="${esc(sim ? moneyIn(S.draft.custoLog) : '')}" placeholder="${sim ? '0,00' : 'Sem custo logístico'}" inputmode="decimal" autocomplete="off" ${sim ? '' : 'disabled'}></div>
    <small class="fld-help">${sim ? 'Frete, coleta, devolução, reentrega…' : 'Marque “Sim” para informar o valor.'}</small></label>`;
}
const custoTotalInfo = () => `<span>Prejuízo total da NC</span><b>${money(custoTotal(S.draft))}</b><small>prejuízo estimado${S.draft.custoLogHouve === 'sim' ? ' + custo logístico' : ''}</small>`;
function refreshCustoLog() {
  const w = $('#custolog-fld'); if (w) w.innerHTML = custoLogField();
  const t = $('#custo-total'); if (t) t.innerHTML = custoTotalInfo();
}
/** Responsável pela NC: obrigatoriamente um usuário ativo; sugerido pelo setor (Configurações). */
function respField() {
  const d = S.draft, val = d.responsavel || '';
  const g = d.setor ? gestorSetor(d.setor) : '';
  const orfao = val && !S.pessoas.includes(val);
  const hint = !d.setor ? 'escolha o setor primeiro'
    : g && S.pessoas.includes(g) ? (val === g ? 'gestor da área' : `gestor da área: ${esc(g)}`)
    : 'setor sem gestor definido';
  const daArea = d.setor ? S.pessoas.filter(p => p === g || equipeSetor(d.setor).includes(p)) : [];
  const outros = S.pessoas.filter(p => !daArea.includes(p));
  const opt = p => `<option value="${esc(p)}" ${p === val ? 'selected' : ''}>${esc(p)}${p === g ? ' (gestor)' : ''}</option>`;
  return `<label class="fld" data-fld="responsavel"><span>Responsável pelo tratamento <b>*</b> <span class="hint" id="resp-hint">${hint}</span></span>
    <select data-f="responsavel"><option value="">Selecione o usuário…</option>
      ${daArea.length ? `<optgroup label="${esc(d.setor)}">${daArea.map(opt).join('')}</optgroup><optgroup label="Outros usuários">${outros.map(opt).join('')}</optgroup>` : outros.map(opt).join('')}
      ${orfao ? `<option value="${esc(val)}" selected disabled>${esc(val)} (não é usuário — escolha outro)</option>` : ''}
    </select></label>`;
}
function applySetorResp(setor) {
  const r = gestorSetor(setor);
  const daArea = r === S.draft.responsavel || equipeSetor(setor).includes(S.draft.responsavel);
  if (r && S.pessoas.includes(r) && !daArea) {   // sugere o gestor, sem trocar quem já é da área
    S.draft.responsavel = r;
    toast(`Responsável definido pelo setor: ${r} (gestor)`, 'info');
  }
  const f = $('[data-fld="responsavel"]');
  if (f) { f.outerHTML = respField(); }
  applySetorCusto(setor);
  refreshGestorArea();
}
/** Prejuízo estimado: usa o custo médio do setor (Configurações) quando o valor está vazio ou foi preenchido automaticamente. */
const custoMedio = setor => (S.cfg?.setorCusto || {})[setor] || '';
function applySetorCusto(setor) {
  const d = S.draft, cm = custoMedio(setor);
  if (!(+d.custo > 0) || d._custoAuto) {
    d.custo = cm; d._custoAuto = !!cm;
    const inp = $('[data-f="custo"]'); if (inp) inp.value = moneyIn(cm);
    if (cm) toast(`Prejuízo estimado: custo médio de ${setor} (${money(cm)})`, 'info');
  }
  const h = $('#custo-help');
  if (h) h.innerHTML = custoHelp(setor);
  const t = $('#custo-total'); if (t) t.innerHTML = custoTotalInfo();
}
const custoHelp = setor => `Retrabalho, custos de transporte, mão de obra…${custoMedio(setor) ? ` · Custo médio de ${esc(setor)}: <b>${money(custoMedio(setor))}</b>` : ''}`;
function secCont(n = 3) {
  return sec('cont', n, 'Justificativa do responsável', 'Explicação do responsável sobre o ocorrido, o que foi feito de imediato e o destino do produto não conforme.', `
    <div class="grid">
      ${fld('Justificativa do responsável', 'contencao.descricao', { type: 'textarea', cls: 'c4', rows: 3, ph: 'Ex.: Peças segregadas e identificadas com etiqueta vermelha; inspeção 100% do lote…',
        help: S.isNew ? 'Preenchida pelo responsável na etapa Em análise — não é obrigatória na abertura.' : 'Obrigatória para enviar a NC para autorização.' })}
      ${fld('Data', 'contencao.data', { type: 'date' })}
    </div>`);
}
function secCausa(n = 4) {
  const d = S.draft;
  return sec('causa', n, 'Análise de causa', 'Use os 5 Porquês para chegar à causa raiz.', `
    <div class="sub-h">5 Porquês <small>— pergunte “por quê?” até chegar à origem do problema</small></div>
    <div class="whys">${[0, 1, 2, 3, 4].map(i => `<label class="why"><b>${i + 1}º Por quê?</b><input data-f="causa.porques.${i}" value="${esc(d.causa.porques[i])}" placeholder="${i === 0 ? 'Por que a não conformidade ocorreu?' : 'Por que isso aconteceu?'}"></label>`).join('')}</div>
    <div class="grid sub-gap">${fld('Causa raiz identificada', 'causa.causaRaiz', { type: 'textarea', cls: 'c4', rows: 3, ph: 'Conclusão da análise: qual a causa raiz que, eliminada, impede a reincidência?' })}</div>`);
}
function acoesHTML() {
  const a = S.draft.acoes;
  const add = `<button class="btn btn-secondary btn-sm add-row" data-act="add-acao">${icon('plus')} Adicionar ação</button>`;
  if (!a.length) return `<div class="empty-mini">Nenhuma ação cadastrada. Defina ações corretivas que eliminem a causa raiz.</div>${add}`;
  return `<div class="acoes">${a.map((x, i) => `
    <div class="acao" style="--c:${ACAO_COLOR[x.status] || '#5f7593'}">
      <div class="acao-n">${i + 1}</div>
      <div class="grid">
        ${fld('O quê (ação)', `acoes.${i}.descricao`, { type: 'textarea', rows: 2, req: true, cls: 'c3', w2h: 'WHAT', ph: 'O que será feito?' })}
        ${fld('Tipo', `acoes.${i}.tipo`, { type: 'select', opts: ACAO_TIPOS })}
        ${fld('Por quê', `acoes.${i}.porque`, { cls: 'c2', w2h: 'WHY', ph: 'Justificativa / causa que trata' })}
        ${fld('Onde', `acoes.${i}.onde`, { w2h: 'WHERE', ph: 'Local / setor' })}
        ${fld('Quem', `acoes.${i}.responsavel`, { list: 'dl-resp', req: true, w2h: 'WHO' })}
        ${fld('Como', `acoes.${i}.como`, { cls: 'c2', w2h: 'HOW', ph: 'Método / etapas' })}
        ${fld('Quando (prazo)', `acoes.${i}.prazo`, { type: 'date', req: true, w2h: 'WHEN' })}
        ${fld('Quanto custa (R$)', `acoes.${i}.custo`, { type: 'money', w2h: 'HOW MUCH', ph: '0,00' })}
        ${fld('Status', `acoes.${i}.status`, { type: 'select', opts: ACAO_STATUS })}
        ${fld('Concluída em', `acoes.${i}.conclusao`, { type: 'date' })}
        ${fld('Evidência de execução', `acoes.${i}.obs`, { cls: 'c2', ph: 'Ex.: instrução revisada IT-045 rev.3' })}
      </div>
      <button class="icon-btn danger" data-act="del-acao" data-i="${i}" title="Remover ação">${icon('trash')}</button>
    </div>`).join('')}</div>${add}`;
}
function secEfic() {
  return sec('efic', 5, 'Verificação de eficácia', 'Após concluir as ações, confirme se o problema foi eliminado e não voltou a ocorrer.', `
    <div class="grid">
      <div class="c2">${segRadio('Resultado', 'eficacia.resultado', [['', 'Pendente', '#7d8ea3'], ['eficaz', 'Eficaz', '#34d399'], ['ineficaz', 'Não eficaz', '#f43f5e']])}</div>
      ${fld('Verificado por', 'eficacia.responsavel', { list: 'dl-resp' })}
      ${fld('Data da verificação', 'eficacia.data', { type: 'date' })}
      ${fld('Evidência / critério de eficácia', 'eficacia.evidencia', { type: 'textarea', cls: 'c4', rows: 3, ph: 'Ex.: 3 lotes consecutivos inspecionados sem reincidência; indicador de refugo abaixo da meta por 60 dias…' })}
    </div>`);
}
function anexosHTML() {
  const a = S.draft.anexos || [];
  if (S.isNew) {   // abertura: arquivos ficam reservados e são enviados ao registrar a NC
    const p = S.pendentes || [];
    return `<div class="anexos">
      ${p.map((x, i) => `<div class="anexo" title="${esc(x.nome)}">
        <div class="thumb" ${x.tipo.startsWith('image/') ? `style="background-image:url('${x.data}')"` : ''}>${x.tipo.startsWith('image/') ? '' : icon('file')}</div>
        <div class="nm">${esc(x.nome)}<small>${fmtSize(x.tamanho)} · será enviado ao registrar</small></div>
        <button class="icon-btn danger" data-act="del-pend" data-i="${i}" title="Remover">${icon('trash')}</button>
      </div>`).join('')}
      <label class="drop" id="drop">${icon('upload')}<span><b>Adicionar arquivos</b><br>clique ou arraste aqui</span><span style="font-size:11px;color:var(--dim)">Imagens são otimizadas · PDF até 8 MB</span><input type="file" id="file-in" multiple accept="image/*,application/pdf" hidden></label>
    </div>`;
  }
  const canE = editable();
  return `<div class="anexos">
    ${a.map(x => `<div class="anexo" data-act="view-anexo" data-id="${x.id}" title="${esc(x.nome)} — ${esc(x.por || '')} ${fmtDT(x.em)}">
      <div class="thumb" ${x.tipo.startsWith('image/') ? `style="background-image:url('${anexoURL(x.id)}')"` : ''}>${x.tipo.startsWith('image/') ? '' : icon('file')}</div>
      <div class="nm">${esc(x.nome)}<small>${fmtSize(x.tamanho || 0)} · ${esc(x.por || '')}</small></div>
      ${canE ? `<button class="icon-btn danger" data-act="del-anexo" data-id="${x.id}" title="Remover">${icon('trash')}</button>` : ''}
    </div>`).join('')}
    ${canE ? `<label class="drop" id="drop">${icon('upload')}<span><b>Adicionar arquivos</b><br>clique ou arraste aqui</span><span style="font-size:11px;color:var(--dim)">Imagens são otimizadas · PDF até 8 MB</span><input type="file" id="file-in" multiple accept="image/*,application/pdf" hidden></label>`
      : (a.length ? '' : '<div class="empty-mini">Nenhum anexo.</div>')}
  </div>`;
}
function secEnc(n = 7) {
  const d = S.draft, g = gestorSetor(d.setor);
  const aut = g ? `o gestor da área <b>${esc(d.setor)}</b> (<b>${esc(g)}</b>)` : d.setor ? `a gestão da área <b>${esc(d.setor)}</b> (sem gestor definido — Qualidade/Administrador)` : 'o gestor da área';
  const quem = d.status === 'encerrada' ? `Encerrada por <b>${esc(d.encerramento?.por || '—')}</b> em ${fmtD(d.encerramento?.data)}.`
    : `Primeiro ${aut} <b>autoriza</b>; depois a <b>Qualidade</b> registra a ação e <b>encerra</b> (perfis Qualidade, Gestor ou Administrador).`;
  const naQualidade = d.status === 'qualidade';
  return sec('enc', n, 'Encerramento', 'Ação da Qualidade para resolver a não conformidade, comentários finais e lições aprendidas.', `
    <div class="enc-who">${icon('lock')}<span>${quem}</span></div>
    <div class="grid">
      ${fld('Ação da Qualidade', 'qualidadeAcao', { type: 'textarea', cls: 'c4', rows: 3, req: naQualidade,
        ph: 'O que a Qualidade fez para resolver o problema (ex.: troca do material com o cliente, reinspeção do lote, ajuste do procedimento)…',
        help: naQualidade ? 'Obrigatório para encerrar a NC.' : 'Preenchida pela Qualidade depois da autorização do gestor da área.' })}
      ${fld('Comentário de encerramento / lições aprendidas', 'encerramento.comentario', { type: 'textarea', cls: 'c4', rows: 2, ph: 'Opcional' })}
    </div>`);
}

/* ---------- Histórico (log) da NC ---------- */
const LOG_TIPOS = { registro: ['Registro', '#3aa8ff', 'plus'], edicao: ['Edição', '#a78bfa', 'edit'], status: ['Etapa / status', '#34d399', 'arrow'], anexo: ['Anexo', '#22d3ee', 'file'], nota: ['Observação', '#f5a524', 'alert'] };
function logTipo(e) {
  const a = e.acao || '';
  if (a.startsWith('Status:')) return 'status';
  if (a.startsWith('Anexo')) return 'anexo';
  if (a.startsWith('Registro atualizado')) return 'edicao';
  if (a.startsWith('Não conformidade registrada') || a.startsWith('Registro importado')) return 'registro';
  return 'nota';
}
function logFiltered() {
  const f = S.logFilter || (S.logFilter = { q: '', user: '', tipo: '' });
  const q = norm(f.q);
  return [...(S.draft.historico || [])].reverse().filter(e => {
    if (f.user && e.usuario !== f.user) return false;
    if (f.tipo && logTipo(e) !== f.tipo) return false;
    if (q && !norm([e.acao, e.usuario, ...(e.alteracoes || []).flatMap(a => [a.campo, a.de, a.para])].join(' ')).includes(q)) return false;
    return true;
  });
}
function secLog(n = 8) {
  const d = S.draft, h = d.historico || [];
  const users = [...new Set(h.map(e => e.usuario))].sort();
  const f = S.logFilter || (S.logFilter = { q: '', user: '', tipo: '' });
  return sec('log', n,'Histórico de alterações', 'Registro automático e inalterável de tudo o que aconteceu nesta NC: quem, quando e o que mudou (antes → depois).', `
    ${h.length ? `<div class="log-tools">
      <label class="search">${icon('search')}<input type="search" data-log="q" value="${esc(f.q)}" placeholder="Buscar no histórico…"></label>
      <select data-log="tipo"><option value="">Todos os eventos</option>${Object.entries(LOG_TIPOS).map(([k, t]) => `<option value="${k}" ${f.tipo === k ? 'selected' : ''}>${t[0]}</option>`).join('')}</select>
      <select data-log="user"><option value="">Todos os usuários</option>${users.map(u => `<option ${f.user === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>
      <button class="btn btn-ghost btn-sm" data-act="export-log">${icon('sheet')}<span>Exportar Excel</span></button>
    </div>` : ''}
    <div id="log-body">${logHTML()}</div>`, `<span class="tag">${h.length} evento${h.length === 1 ? '' : 's'}</span>`);
}
function logHTML() {
  if (S.isNew) return '<div class="empty-mini">O histórico começa quando a NC for registrada.</div>';
  const list = logFiltered();
  if (!list.length) return '<div class="empty-mini">Nenhum evento com esses filtros.</div>';
  return `<ul class="log">${list.map(e => {
    const [lbl, cor, ic] = LOG_TIPOS[logTipo(e)];
    const alt = e.alteracoes || [];
    return `<li style="--c:${cor}">
      <span class="log-ic">${icon(ic)}</span>
      <div class="log-main">
        <div class="log-top"><b>${esc(e.acao)}</b><span class="log-tag">${lbl}</span></div>
        <div class="log-meta">${fmtDT(e.data)} · <span class="avatar xs">${esc(initials(e.usuario))}</span>${esc(e.usuario)}</div>
        ${alt.length ? `<table class="log-diff"><thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead><tbody>${alt.map(a => `<tr><td>${esc(a.campo)}</td><td class="de">${a.de ? esc(a.de) : '<i>vazio</i>'}</td><td class="para">${a.para ? esc(a.para) : '<i>vazio</i>'}</td></tr>`).join('')}</tbody></table>` : ''}
      </div></li>`;
  }).join('')}</ul>`;
}
const renderLog = () => { const b = $('#log-body'); if (b) b.innerHTML = logHTML(); };
function exportLog(d) {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['NC', 'Data/hora', 'Usuário', 'Evento', 'Tipo', 'Campo', 'Antes', 'Depois']];
  (d.historico || []).forEach(e => {
    const base = [d.numero, fmtDT(e.data), e.usuario, e.acao, LOG_TIPOS[logTipo(e)][0]];
    if (e.alteracoes?.length) e.alteracoes.forEach(a => rows.push([...base, a.campo, a.de, a.para]));
    else rows.push([...base, '', '', '']);
  });
  download(`historico_${d.numero}_${todayISO()}.csv`, '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  toast('Histórico exportado');
}
function actionbarHTML() {
  const d = S.draft, st = d.status, canE = editable();
  let b = `<span class="dirty ${S.dirty ? 'on' : ''}" id="dirty">● Alterações não salvas</span><div class="sp"></div>`;
  if (S.isNew) return b + `<a class="btn btn-ghost" href="#/ncs">Cancelar</a>
    <button class="btn btn-secondary" data-act="save-rascunho" title="Guarda a NC incompleta; só você a vê até enviar">${icon('save')}<span class="lg">Salvar rascunho</span><span class="sm">Rascunho</span></button>
    <button class="btn btn-primary" data-act="save" title="Exige os campos obrigatórios e envia ao responsável">${icon('arrow')}<span class="lg">Enviar para análise</span><span class="sm">Enviar</span></button>`;
  const menu = [
    `<button data-act="duplicate">${icon('copy')}Duplicar como nova NC</button>`,
    isOpen(d) && isAdmin() ? `<button data-act="cancel-nc">${icon('ban')}Cancelar NC</button>` : '',
    isAdmin() ? `<button class="danger" data-act="delete">${icon('trash')}Excluir definitivamente</button>` : '',
  ].join('');
  b += `<div class="menu-wrap"><button class="icon-btn" data-act="more" title="Mais opções">${icon('more')}</button><div class="menu" id="more-menu">${menu}</div></div>
    <button class="btn btn-ghost" data-act="print">${icon('print')}<span>Imprimir / PDF</span></button>`;
  if (!isOpen(d)) return b + (isGestao() ? `<button class="btn btn-primary" data-act="reopen">${icon('rotate')}<span>Reabrir</span></button>` : '');
  if (!canE) return b;
  b += `<button class="btn btn-secondary" data-act="save">${icon('save')}<span>${st === 'aberta' ? 'Salvar rascunho' : 'Salvar'}</span></button>`;
  if (st === 'verificacao' && d.eficacia?.resultado === 'ineficaz') b += `<button class="btn btn-warn" data-act="back-analise">${icon('rotate')}<span>Retornar à análise</span></button>`;
  else {
    const nx = FLOW[FLOW.indexOf(st) + 1] || 'encerrada';
    const g = gestorSetor(d.setor);
    const devolver = `<button class="btn btn-warn" data-act="devolver">${icon('rotate')}<span class="lg">Devolver para análise</span><span class="sm">Devolver</span></button>`;
    const botao = (lg, sm, ic, title = lg) => `<button class="btn btn-primary" data-act="advance" title="${title}"><span class="lg">${lg}</span><span class="sm">${sm}</span>${icon(ic)}</button>`;
    if (st === 'autorizacao') {   // gestor da área autoriza e manda para a Qualidade
      b += podeEncerrar(d) ? devolver + botao('Autorizar e enviar à Qualidade', 'Autorizar', 'arrow')
        : `<span class="hint-pill" title="A autorização é feita pelo gestor da área">${icon('lock')} Aguardando autorização: ${g ? esc(g) : 'gestor da área'}</span>`;
    } else if (st === 'qualidade') {   // Qualidade age e encerra
      b += podeFinalizar() ? devolver + botao('Encerrar NC', 'Encerrar', 'check')
        : `<span class="hint-pill" title="O encerramento é feito pela Qualidade">${icon('lock')} Com a Qualidade para ação e encerramento</span>`;
    } else {
      b += nx === 'autorizacao' ? botao('Enviar para autorização', 'Enviar', 'arrow', 'Enviar para autorização' + (g ? ' — gestor: ' + esc(g) : ''))
        : st === 'aberta' ? botao('Enviar para análise', 'Enviar', 'arrow', 'Exige os campos obrigatórios e envia ao responsável')
        : botao('Avançar: ' + STATUS[nx].label, 'Avançar', 'arrow');
    }
  }
  return b;
}
const refreshBar = () => { const ab = $('#actionbar'); if (ab) ab.innerHTML = actionbarHTML(); };
function markDirty() { if (!S.dirty) { S.dirty = true; $('#dirty')?.classList.add('on'); } }

function showInvalid(list) {
  $$('.fld.invalid').forEach(x => x.classList.remove('invalid'));
  list.forEach(f => $(`[data-fld="${f}"]`)?.classList.add('invalid'));
  if (list.length) $(`[data-fld="${list[0]}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** Grava o rascunho no servidor. Retorna true se gravou. */
async function saveDraft({ silent, nota, force, rascunho } = {}) {
  const d = S.draft;
  // rascunho (nova ou já salva como rascunho): só o título é obrigatório
  const rasc = S.isNew ? !!rascunho : d.status === 'aberta';
  const inv = rasc ? ((d.titulo || '').trim() ? [] : [['titulo', 'Título']]) : baseInvalid(d);
  showInvalid(inv.map(x => x[0]));
  if (inv.length) { toast((rasc ? 'Para salvar o rascunho, preencha: ' : 'Preencha: ') + inv.map(x => x[1]).join(', '), 'err'); return false; }
  const btns = $$('#actionbar .btn'); btns.forEach(b => b.disabled = true);
  try {
    const r = S.isNew ? await api('POST', '/ncs', { nc: d, rascunho: rasc }) : await api('PUT', '/ncs/' + d.id, { nc: d, version: d.version, nota, force });
    upsert(r.nc); renderNav();
    S.dirty = false;
    if (S.isNew) {
      S.isNew = false;
      const pend = S.pendentes || []; S.pendentes = [];
      let falhas = 0;
      for (const p of pend) {   // envia os anexos escolhidos na abertura
        try { await api('POST', `/ncs/${r.nc.id}/anexos`, { nome: p.nome, tipo: p.tipo, data: p.data }); }
        catch (e) { falhas++; toast(`${p.nome}: ${e.message}`, 'err'); }
      }
      toast(`${r.nc.numero} ${r.nc.status === 'aberta' ? 'salva como rascunho' : 'enviada para análise'}${pend.length ? ` · ${pend.length - falhas} anexo(s) enviado(s)` : ''}`);
      if (pend.length) await poll();
      location.hash = '#/nc/' + r.nc.id;
    } else {
      if (!silent) toast('Alterações salvas');
      loadDraft(r.nc);
    }
    return true;
  } catch (e) {
    btns.forEach(b => b.disabled = false);
    if (e.status === 409) return resolveConflict(e);
    if (e.status === 422 && e.data?.pendencias) { await showPendencias(e); return false; }
    if (e.status === 422 && e.data?.campos) showInvalid(e.data.campos);
    toast(e.message, 'err');
    return false;
  }
}
async function resolveConflict(e) {
  const choice = await modal({
    title: 'Conflito de edição',
    body: `<p><b>${esc(e.data.por || 'Outro usuário')}</b> alterou esta NC em ${fmtDT(e.data.em)}, enquanto você editava.</p><p style="margin-top:10px">Você pode descartar suas alterações e carregar a versão atual, ou salvar a sua versão por cima da versão atual.</p>`,
    actions: [{ label: 'Voltar', value: null }, { label: 'Carregar versão atual', value: 'reload', cls: 'btn-secondary' }, { label: 'Salvar a minha por cima', value: 'force', cls: 'btn-warn' }],
  });
  if (choice === 'reload') { upsert(e.data.nc); loadDraft(e.data.nc); toast('Versão atual carregada', 'info'); }
  if (choice === 'force') return saveDraft({ force: true });
  return false;
}

async function changeStatus(to, { confirmMsg, nota, okMsg } = {}) {
  const d = S.draft, prev = d.status;
  if (confirmMsg && !(await confirmBox(confirmMsg[0], confirmMsg[1], confirmMsg[2]))) return;
  d.status = to;
  const ok = await saveDraft({ silent: true, nota });
  if (!ok) { if (S.draft === d) d.status = prev; return; }
  toast(okMsg || `${d.numero} → ${STATUS[to].label}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
async function advance() {
  const d = S.draft;
  const inv = baseInvalid(d); showInvalid(inv.map(x => x[0]));
  if (inv.length) { toast('Preencha: ' + inv.map(x => x[1]).join(', '), 'err'); return; }
  const m = missingFor(d);
  if (m.length) { await modal({ title: 'Pendências para avançar', body: `<p>Antes de avançar de <b>${STATUS[d.status].label}</b>:</p><ul>${m.map(x => `<li>${x}</li>`).join('')}</ul>`, actions: [{ label: 'Entendi', value: true, cls: 'btn-primary' }] }); return; }
  const nx = FLOW[FLOW.indexOf(d.status) + 1] || 'encerrada';
  if (nx === 'autorizacao') {
    const g = gestorSetor(d.setor);
    return changeStatus(nx, { confirmMsg: ['Enviar para autorização', `Enviar <b>${esc(d.numero)}</b> para autorização ${g ? `de <b>${esc(g)}</b> (gestão da área ${esc(d.setor)})` : 'da gestão da área'}?`, 'Enviar'], okMsg: `${d.numero} enviada para autorização` });
  }
  if (d.status === 'aberta')
    return changeStatus(nx, { confirmMsg: ['Enviar para análise', `Enviar <b>${esc(d.numero)}</b> para análise? Ela sai do rascunho e vai para o responsável <b>${esc(d.responsavel || '')}</b>.`, 'Enviar'], okMsg: `${d.numero} enviada para análise` });
  if (nx === 'qualidade')
    return changeStatus(nx, { confirmMsg: ['Autorizar e enviar à Qualidade', `Autorizar <b>${esc(d.numero)}</b> e enviar para a <b>Qualidade</b> agir e encerrar?`, 'Autorizar'], okMsg: `${d.numero} autorizada e enviada à Qualidade` });
  await changeStatus(nx, nx === 'encerrada' ? { confirmMsg: ['Encerrar não conformidade', `Confirma o encerramento de <b>${esc(d.numero)}</b>? O registro ficará bloqueado para edição.`, 'Encerrar'] } : {});
}

/* ---------- Anexos ---------- */
const readFile = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
async function compressImg(f) {
  const url = await readFile(f);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const max = 1600; let w = img.width, h = img.height;
  if (Math.max(w, h) > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.82);
}
async function addFiles(files) {
  const d = S.draft; if (!d) return;
  for (const f of files) {
    try {
      let data, tipo;
      if (f.type.startsWith('image/')) { data = await compressImg(f); tipo = 'image/jpeg'; }
      else if (f.type === 'application/pdf') {
        if (f.size > 8 * 1024 * 1024) { toast(`${f.name}: PDF maior que 8 MB`, 'err'); continue; }
        data = await readFile(f); tipo = f.type;
      } else { toast(`${f.name}: formato não suportado`, 'err'); continue; }
      if (S.isNew) {   // ainda não registrada: guarda para enviar ao registrar
        (S.pendentes ||= []).push({ nome: f.name, tipo, data, tamanho: Math.round(data.length * 0.75) });
        markDirty(); $('#anexos-body').innerHTML = anexosHTML(); bindDrop(); continue;
      }
      toast(`Enviando ${f.name}…`, 'info');
      const r = await api('POST', `/ncs/${d.id}/anexos`, { nome: f.name, tipo, data });
      d.anexos.push(r.anexo);
      const cached = S.ncs.find(n => n.id === d.id); if (cached) cached.anexos = [...d.anexos];
      $('#anexos-body').innerHTML = anexosHTML(); bindDrop();
      toast(`${f.name} anexado`); poll();
    } catch (e) { toast(`${f.name}: ${e.message}`, 'err'); }
  }
}
function bindDrop() {
  const dz = $('#drop'); if (!dz) return;
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, () => dz.classList.remove('over')));
  dz.addEventListener('drop', e => { e.preventDefault(); addFiles([...e.dataTransfer.files]); });
}
function openAnexo(a) {
  if (a.tipo.startsWith('image/')) modal({ title: esc(a.nome), body: `<img src="${anexoURL(a.id)}" alt="">`, wide: true, actions: [{ label: 'Fechar', value: true, cls: 'btn-primary' }] });
  else window.open(anexoURL(a.id), '_blank');
}

/* ---------- Impressão / PDF (A4 retrato, com pré-visualização) ---------- */
/** Linha do tempo das etapas, montada a partir do histórico ("Status: X → Y"). */
function timelineNC(d) {
  const byLabel = Object.fromEntries(Object.entries(STATUS).map(([k, s]) => [s.label, k]));
  const ent = { aberta: { data: d.createdAt || d.dataRegistro, por: d.criadoPor } };
  (d.historico || []).forEach(e => {
    const m = /^Status: (.+) → (.+)$/.exec(e.acao || ''); if (!m) return;
    const k = byLabel[m[2].trim()]; if (k) ent[k] = { data: e.data, por: e.usuario };
  });
  const canc = d.status === 'cancelada';
  const etapas = canc ? [...FLOW.filter(k => k !== 'encerrada'), 'cancelada'] : FLOW;
  const cur = canc ? etapas.length - 1 : Math.max(0, etapas.indexOf(d.status));
  return etapas.map((k, i) => {
    const st = i < cur ? 'done' : i === cur ? (k === 'encerrada' ? 'done' : k === 'cancelada' ? 'canc' : 'cur') : 'todo';
    const e = i <= cur ? ent[k] : null;
    const dias = e && i < cur && ent[etapas[i + 1]] ? dayDiff(e.data.slice(0, 10), ent[etapas[i + 1]].data.slice(0, 10)) : null;
    return { k, label: STATUS[k].label, st, e, dias };
  });
}
async function printNC(d) {
  const f = (l, v, c = '') => `<div class="p-f ${c}"><span>${l}</span><b>${esc(v) || '—'}</b></div>`;
  const txt = v => `<div class="p-txt">${esc(v) || '—'}</div>`;
  const blk = (t, b) => `<section class="p-sec"><h3>${t}</h3>${b}</section>`;
  const imgs = (d.anexos || []).filter(a => a.tipo.startsWith('image/'));
  const sev = SEV[d.severidade];
  const tl = timelineNC(d);
  const prazoTxt = !d.prazo ? '—' : !isOpen(d) ? fmtD(d.prazo) : (() => { const x = dayDiff(todayISO(), d.prazo); return `${fmtD(d.prazo)} (${x < 0 ? `vencido há ${-x} dia${x === -1 ? '' : 's'}` : x === 0 ? 'vence hoje' : `faltam ${x} dia${x === 1 ? '' : 's'}`})`; })();
  const pa = $('#print-area');
  pa.innerHTML = `
  <div class="p-toolbar"><b>Pré-visualização · ${esc(d.numero)}</b><em id="p-fit-info" class="p-fit-info"></em><span>A4 retrato · para gerar o PDF escolha <i>Salvar como PDF</i> no destino da impressão</span>
    <button class="btn btn-ghost" data-act="print-close">${icon('x')}<span>Fechar</span></button>
    <button class="btn btn-primary" data-act="print-go">${icon('print')}<span>Imprimir / Salvar PDF</span></button></div>
  <div class="p-page"><div class="p-fit">
    <header class="p-head"><img src="assets/logo-melting.png" alt="Melting"><div class="p-ttl"><h1>Relatório de Não Conformidade</h1><p>Gestão de Não Conformidades · Emitido em ${fmtDT(nowISO())} por ${esc(S.me.nome)}</p></div>
      <div class="p-num"><span>Nº da NC</span><b>${esc(d.numero || '—')}</b></div></header>
    <div class="p-line"></div>
    <div class="p-summary">
      <div class="p-sum-main"><span>Título</span><b>${esc(d.titulo) || '—'}</b></div>
      <div class="p-chips"><span class="p-chip" style="--c:${STATUS[d.status].color}">${STATUS[d.status].label}</span>${sev ? `<span class="p-chip" style="--c:${sev.color}">Severidade ${sev.label}</span>` : ''}<span class="p-chip p-chip-n">${esc(d.setor || '—')}</span></div>
    </div>
    <section class="p-sec p-tl-sec"><h3>Linha do tempo</h3>
      <ol class="p-tl">${tl.map(s => `<li class="${s.st}"><i>${s.st === 'done' ? '✓' : s.st === 'canc' ? '✕' : s.st === 'cur' ? '●' : ''}</i><b>${s.label}</b>
        <small>${s.e ? `${fmtDT(s.e.data)}<br>${esc(s.e.por || '')}` : s.st === 'todo' ? 'Pendente' : ''}</small>${s.dias != null ? `<em>${s.dias} dia${s.dias === 1 ? '' : 's'}</em>` : ''}</li>`).join('')}</ol>
      <p class="p-tl-note">Etapa atual: <b>${STATUS[d.status].label}</b>${isOpen(d) && gestorSetor(d.setor) ? ` · Autorização/encerramento: ${esc(gestorSetor(d.setor))} (gestor da área)` : ''}${d.status === 'encerrada' ? ` · Encerrada em ${fmtD(d.encerramento?.data)} por ${esc(d.encerramento?.por || '—')}` : ''}</p>
    </section>
    ${blk('1. Identificação', `<div class="p-grid">
      ${f('Cliente / Fornecedor', d.cliente, 'c2')}${f('Nº Pedido / NF / OC', d.os)}${f('Data da ocorrência', fmtD(d.dataOcorrencia))}
      ${f('Origem / detecção', d.origem)}${f('Setor responsável pela NC', d.setor)}
      ${f('Item / equipamento / peça', d.item, 'c2')}${f('Quantidade afetada', d.quantidade)}${f('Reincidente', d.reincidente === 'sim' ? 'Sim ' + (d.ncRelacionada ? '(' + d.ncRelacionada + ')' : '') : 'Não')}
      ${f('Registrada em', `${fmtD(d.dataRegistro)} — ${d.criadoPor || ''}`, 'c2')}${f('Detectado por', d.detectadoPor)}${f('Responsável pelo tratamento', d.responsavel)}
      ${f('Prazo para tratamento', prazoTxt, 'c2')}
    </div><h4>Descrição</h4>${txt(d.descricao)}`)}
    ${blk('Custos da não conformidade', `<div class="p-costs">
      <div><span>Prejuízo estimado</span><b>${money(d.custo)}</b></div>
      <div><span>Custo logístico</span><b>${d.custoLogHouve === 'sim' ? money(d.custoLog) : d.custoLogHouve === 'nao' ? 'Não houve' : '—'}</b></div>
      <div class="tot"><span>Prejuízo total</span><b>${money(custoTotal(d))}</b></div></div>`)}
    ${blk('2. Justificativa do responsável', `${txt(d.contencao?.descricao)}<div class="p-grid" style="margin-top:6px">${f('Data', fmtD(d.contencao?.data))}</div>`)}
    ${blk('3. Análise de causa', `
      ${(d.causa?.porques || []).some(x => x) ? `<h4>5 Porquês</h4><table class="p-tbl">${d.causa.porques.map((p, i) => p ? `<tr><th style="width:90px">${i + 1}º Por quê</th><td>${esc(p)}</td></tr>` : '').join('')}</table>` : ''}
      <h4>Causa raiz</h4>${txt(d.causa?.causaRaiz)}`)}
    ${!PLANO_ACAO ? '' : blk('4. Plano de ação (5W2H)', (d.acoes || []).length ? `<table class="p-tbl"><thead><tr><th>#</th><th>O quê</th><th>Por quê / Como</th><th>Onde</th><th>Quem</th><th>Quando</th><th>Quanto</th><th>Status</th></tr></thead><tbody>
      ${d.acoes.map((a, i) => `<tr><td>${i + 1}</td><td>${esc(a.descricao)}<br><small>${esc(a.tipo)}</small></td><td>${esc(a.porque)}${a.como ? '<br><i>' + esc(a.como) + '</i>' : ''}</td><td>${esc(a.onde)}</td><td>${esc(a.responsavel)}</td><td>${fmtD(a.prazo)}</td><td>${a.custo ? money(a.custo) : '—'}</td><td>${esc(a.status)}${a.conclusao ? '<br>' + fmtD(a.conclusao) : ''}</td></tr>`).join('')}
      </tbody></table>` : txt(''))}
    ${!PLANO_ACAO ? '' : blk('5. Verificação de eficácia', `<div class="p-grid">${f('Resultado', d.eficacia?.resultado === 'eficaz' ? 'Eficaz' : d.eficacia?.resultado === 'ineficaz' ? 'Não eficaz' : 'Pendente')}${f('Verificado por', d.eficacia?.responsavel)}${f('Data', fmtD(d.eficacia?.data))}</div><h4>Evidência</h4>${txt(d.eficacia?.evidencia)}`)}
    ${blk(PLANO_ACAO ? '6. Encerramento' : '4. Encerramento',`<h4>Ação da Qualidade</h4>${txt(d.qualidadeAcao)}<div class="p-grid" style="margin-top:6px">${f('Data', fmtD(d.encerramento?.data))}${f('Encerrado por', d.encerramento?.por)}</div><h4>Comentários</h4>${txt(d.encerramento?.comentario)}`)}
    ${imgs.length ? blk('Evidências', `<div class="p-imgs">${imgs.map(a => `<figure><img src="${anexoURL(a.id)}" alt=""><figcaption>${esc(a.nome)}</figcaption></figure>`).join('')}</div>`) : ''}
    ${(() => {   // folha única: só os eventos relevantes (as mudanças de etapa já estão na linha do tempo)
      const ev = (d.historico || []).filter(e => !/^(Registro atualizado|Anexo |Status:|Não conformidade registrada)/.test(e.acao || '')).slice(-6);
      const tot = (d.historico || []).length;
      return ev.length ? blk('Ocorrências registradas', `<table class="p-tbl p-log"><thead><tr><th style="width:105px">Data/hora</th><th style="width:120px">Usuário</th><th>Ocorrência</th></tr></thead><tbody>
      ${ev.map(e => `<tr><td>${fmtDT(e.data)}</td><td>${esc(e.usuario)}</td><td>${esc(e.acao)}</td></tr>`).join('')}
    </tbody></table><p class="p-log-note">Histórico completo (${tot} registros) disponível no sistema.</p>`) : '';
    })()}
    ${(() => {   // assinaturas: o nome do usuário em letra cursiva sobre a linha
      const enc = d.status === 'encerrada' && d.encerramento?.por;
      const qual = (S.cfg?.setorGestor || {})['Qualidade'] || '';
      const sig = (papel, nome, nota) => `<div><span class="p-sig">${esc(nome || '')}</span><i></i>${papel}${nome ? `<br><small>${esc(nome)}${nota ? ` · ${nota}` : ''}</small>` : ''}</div>`;
      return `<div class="p-sign">${sig('Responsável pelo tratamento', d.responsavel)}${sig('Qualidade', qual)}${sig('Gestor da área', enc ? d.encerramento.por : gestorSetor(d.setor), enc ? `encerrou em ${fmtD(d.encerramento.data)}` : '')}</div>`;
    })()}
    <div class="p-foot">Melting — Soluções em Manutenção Industrial · Gestão de Não Conformidades · ${esc(d.numero || '')}</div>
  </div></div>`;
  document.body.classList.add('print-preview');
  pa.scrollTop = 0;
  fitPage();
  await Promise.all($$('img', pa).map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })));
  fitPage();
}
/** Encaixa o relatório inteiro em UMA folha A4 retrato: reduz a escala (zoom) quando o conteúdo passa da altura útil. */
const MM = 96 / 25.4;                 // px por mm
const P_W = 186, P_H = 273;           // área útil da folha: 210×297 mm menos margens de 12 mm
function fitPage() {
  const fit = $('#print-area .p-fit'); if (!fit) return;
  const alvo = P_H * MM * 0.985;
  const aplica = z => { fit.style.width = (P_W / z) + 'mm'; fit.style.zoom = z; return fit.getBoundingClientRect().height; };
  let z = 1, h = aplica(1), ok = h <= alvo ? 1 : 0;
  // a escala menor deixa o conteúdo mais largo (e mais baixo): converge em poucas rodadas
  for (let i = 0; i < 6 && !ok; i++) {
    z = Math.max(0.2, z * alvo / h);
    h = aplica(z);
    if (h <= alvo) ok = z;
  }
  if (ok && ok < 1) {                       // aproveita a folha: tenta crescer um pouco mantendo 1 página
    for (let i = 0; i < 4; i++) { const z2 = Math.min(1, ok * Math.min(1.08, alvo / h)); if (z2 <= ok + 0.002) break; h = aplica(z2); if (h <= alvo) ok = z2; else { aplica(ok); break; } }
  }
  aplica(ok || z);
  const pct = Math.round(parseFloat(fit.style.zoom) * 100);
  const info = $('#p-fit-info'); if (info) info.textContent = pct < 100 ? `Ajustado para 1 página · escala ${pct}%` : '1 página · tamanho normal';
}
window.addEventListener('beforeprint', fitPage);
function closePrint() { document.body.classList.remove('print-preview'); $('#print-area').innerHTML = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('print-preview')) closePrint(); });
window.addEventListener('hashchange', () => { if (document.body.classList.contains('print-preview')) closePrint(); });

/* =========================================================
   USUÁRIOS (admin)
   ========================================================= */
async function renderUsers() {
  setTitle('Usuários');
  const v = $('#view');
  v.innerHTML = '<div class="empty-mini">Carregando…</div>';
  try { S.users = (await api('GET', '/users')).users; } catch (e) { v.innerHTML = `<div class="empty-mini">${esc(e.message)}</div>`; return; }
  const u = S.users, adm = isAdmin();
  const abas = `<div class="user-tabs"><button class="${S.userTab === 'logs' ? '' : 'on'}" data-act="user-tab" data-tab="usuarios">${icon('users')} Usuários</button><button class="${S.userTab === 'logs' ? 'on' : ''}" data-act="user-tab" data-tab="logs">${icon('clock')} Logs de acesso</button></div>`;
  if (S.userTab === 'logs') { v.innerHTML = abas + '<div id="logs-view"></div>'; return renderLogs(); }
  v.innerHTML = abas + `
    ${adm ? '' : `<div class="banner mute" style="margin-bottom:14px">${icon('lock')}<div><b>Somente consulta.</b> Como Gestor, você vê todos os usuários, mas apenas o administrador cria, altera ou exclui.</div></div>`}
    <div class="toolbar"><p class="muted" style="flex:1;font-size:13px">${u.filter(x => x.ativo).length} usuário(s) ativo(s). O nome do usuário deve ser o mesmo usado no campo <b>Responsável</b> das NCs para que ele possa tratá-las.</p>
      ${adm ? `<button class="btn btn-primary" data-act="user-new">${icon('plus')} Novo usuário</button>` : ''}</div>
    <div class="perfis">${Object.entries(PERFIS).map(([k, p]) => `<div class="card perfil">${pillPerfil(k)}<p>${p.desc}</p></div>`).join('')}</div>
    <div class="card table-wrap"><table class="tbl users"><thead><tr><th>Nome</th><th>Usuário</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th></th></tr></thead><tbody>
      ${u.map(x => `<tr class="${x.ativo ? '' : 'inactive'}">
        <td class="tt"><span class="uname"><span class="avatar sm">${esc(initials(x.nome))}</span>${esc(x.nome)}</span><small>${esc(x.email || '')}</small></td>
        <td>${esc(x.login)}</td>
        <td>${pillPerfil(x.perfil)}</td>
        <td>${x.ativo ? `<span class="txt-ok">Ativo</span>${x.trocarSenha ? '<small class="muted"> · senha provisória</small>' : ''}` : '<span class="muted">Desativado</span>'}</td>
        <td class="hide-m">${x.ultimoAcesso ? fmtDT(x.ultimoAcesso) : '—'}</td>
        <td class="row-actions"><button class="btn btn-ghost btn-sm" data-act="user-logs" data-id="${x.id}" title="Ver os logs deste usuário">${icon('clock')} Logs</button>${adm ? `<button class="btn btn-ghost btn-sm" data-act="user-edit" data-id="${x.id}">${icon('edit')} Editar</button>` : ''}</td>
      </tr>`).join('')}
    </tbody></table></div>`;
}
/* ---------- Logs de acesso (auditoria) ---------- */
const LOG_TIPOS_AUD = { Acesso: '#38bdf8', NC: '#f5a524', 'Usuários': '#a78bfa', 'Configurações': '#f472b6' };
async function renderLogs() {
  const box = $('#logs-view'); if (!box) return;
  const f = S.logF ||= { user: '', tipo: '', de: '', ate: '', q: '' };
  const qs = new URLSearchParams(Object.entries(f).filter(([, x]) => x)); qs.set('limit', '1000');
  box.innerHTML = `<div class="toolbar logs-tb">
      <label class="search">${icon('search')}<input type="search" data-logf="q" value="${esc(f.q)}" placeholder="Buscar ação, detalhe, NC…"></label>
      <select data-logf="user"><option value="">Todos os usuários</option>${S.users.map(x => `<option value="${x.id}" ${String(x.id) === f.user ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select>
      <select data-logf="tipo"><option value="">Todos os tipos</option>${Object.keys(LOG_TIPOS_AUD).map(t => `<option ${t === f.tipo ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input type="date" data-logf="de" value="${esc(f.de)}" title="De">
      <input type="date" data-logf="ate" value="${esc(f.ate)}" title="Até">
      <button class="btn btn-ghost" data-act="logs-csv">${icon('sheet')}<span>Exportar Excel</span></button>
    </div><div class="empty-mini">Carregando…</div>`;
  let r;
  try { r = await api('GET', '/auditoria?' + qs.toString()); } catch (e) { box.lastElementChild.textContent = e.message; return; }
  S.logRows = r.logs;
  box.lastElementChild.outerHTML = `<p class="result-info">${r.logs.length < r.total ? `Mostrando os <b>${r.logs.length}</b> mais recentes de ${r.total}` : `<b>${r.total}</b> registro(s)`} · entradas, saídas, tentativas de acesso e alterações feitas no sistema.</p>
    <div class="card table-wrap"><table class="tbl logs"><thead><tr><th>Data/hora</th><th>Usuário</th><th>Tipo</th><th>Evento</th><th>Detalhe</th><th class="hide-m">IP</th></tr></thead><tbody>
    ${r.logs.map(l => `<tr class="${/falhou|inexistente|desativado/.test(l.acao) ? 'log-alerta' : ''}">
      <td class="nowrap">${fmtDT(l.data)}</td>
      <td>${esc(l.usuario || '—')}${l.login ? `<small>${esc(l.login)}</small>` : ''}</td>
      <td><span class="pill" style="--c:${LOG_TIPOS_AUD[l.tipo] || '#93a7c0'}"><i></i>${esc(l.tipo)}</span></td>
      <td class="tt">${l.ref && S.ncs.some(n => n.numero === l.ref) ? `<a class="linkbtn" href="#/nc/${S.ncs.find(n => n.numero === l.ref).id}">${esc(l.acao)}</a>` : esc(l.acao)}</td>
      <td class="log-det">${esc(l.detalhe || '')}</td>
      <td class="hide-m nowrap">${esc(l.ip || '')}</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty-mini">Nenhum registro para esses filtros.</div></td></tr>'}
    </tbody></table></div>`;
}
function exportLogsCSV() {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Data/hora', 'Usuário', 'Login', 'Tipo', 'Evento', 'Detalhe', 'NC', 'IP'], ...(S.logRows || []).map(l => [fmtDT(l.data), l.usuario, l.login, l.tipo, l.acao, l.detalhe, l.ref, l.ip])];
  download(`logs-de-acesso_${todayISO()}.csv`, '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  toast(`${rows.length - 1} registro(s) exportado(s)`);
}
const perfilOpts = Object.entries(PERFIS).map(([k, p]) => [k, p.label]);
async function showTempPassword(nome, login, senha, email) {
  const aviso = !email ? '' : email.enviado
    ? `<p class="txt-ok" style="margin-bottom:12px">✓ Senha enviada por e-mail para <b>${esc(email.para)}</b>.</p>`
    : `<p style="margin-bottom:12px;color:var(--warn)">⚠ E-mail não enviado: ${esc(email.motivo || 'erro desconhecido')} Repasse os dados abaixo manualmente.</p>`;
  await modal({ title: 'Senha provisória', body: `${aviso}<p>${email?.enviado ? 'Dados enviados a' : 'Informe a'} <b>${esc(nome)}</b>:</p><div class="pw-box"><div><span>Endereço</span><b>${esc(location.origin)}</b></div><div><span>Usuário</span><b>${esc(login)}</b></div><div><span>Senha provisória</span><b>${esc(senha)}</b></div></div><p style="margin-top:12px">Ela será solicitada a trocar a senha no primeiro acesso. Esta senha não será exibida novamente.</p>`, actions: [{ label: 'Pronto', value: true, cls: 'btn-primary' }] });
}
async function userNew() {
  let created;
  const r = await formModal('Novo usuário', `
    ${inp('Nome completo', 'nome', { req: true, cls: 'c2', ph: 'Como aparece nas NCs (ex.: Jorge Lima)' })}
    ${inp('Usuário de acesso', 'login', { req: true, ph: 'ex.: jorge.lima' })}
    ${inp('E-mail', 'email', { ph: REMOTE ? 'recebe a senha provisória por e-mail' : 'opcional' })}
    ${inp('Perfil', 'perfil', { opts: perfilOpts, value: 'colaborador', cls: 'c2' })}
    ${inp('Senha inicial', 'senha', { type: 'text', cls: 'c2', ph: 'Deixe em branco para gerar uma automaticamente' })}`,
    'Criar usuário', async v => { created = await api('POST', '/users', v); });
  if (r) { await showTempPassword(r.nome, r.login, created.senha, created.email); renderUsers(); }
}
async function userEdit(id) {
  const x = S.users.find(u => u.id === +id); if (!x) return;
  let res;
  const r = await formModal(`Editar ${esc(x.nome)}`, `
    ${inp('Nome completo', 'nome', { req: true, cls: 'c2', value: x.nome })}
    ${inp('E-mail', 'email', { value: x.email })}
    ${inp('Perfil', 'perfil', { opts: perfilOpts, value: x.perfil })}
    <label class="check c2"><input type="checkbox" name="ativo" ${x.ativo ? 'checked' : ''}> Usuário ativo (desmarque para bloquear o acesso)</label>
    <label class="check c2"><input type="checkbox" name="resetSenha"> Gerar nova senha provisória</label>
    ${x.id !== S.me.id ? `<div class="c2 user-del-zone"><div><b>Excluir usuário</b><small>Para desligamento de funcionário. Remove o acesso de forma definitiva.</small></div>
      <button type="button" class="btn btn-danger btn-sm" data-act="user-del" data-id="${x.id}">${icon('trash')} Excluir usuário</button></div>` : ''}`,
    'Salvar', async v => { res = await api('PUT', '/users/' + x.id, v); },
    { intro: `<p style="margin-bottom:12px">Usuário de acesso: <b style="color:var(--text)">${esc(x.login)}</b></p>` });
  if (!r) return;
  if (res.senha) await showTempPassword(r.nome, x.login, res.senha, res.email);
  else toast('Usuário atualizado');
  if (x.id === S.me.id) { S.me.nome = r.nome; S.me.perfil = r.perfil; renderUser(); renderNav(); }
  renderUsers();
}
/** Exclusão definitiva (desligamento). As NCs mantêm o nome no histórico; quem ficou sem responsável é avisado. */
async function userDelete(id) {
  const x = S.users.find(u => u.id === +id); if (!x) return;
  const abertas = S.ncs.filter(n => isOpen(n) && norm(n.responsavel) === norm(x.nome)).length;
  const ok = await confirmBox('Excluir usuário',
    `Excluir definitivamente <b>${esc(x.nome)}</b> (${esc(x.login)})?<br><br>
     • O acesso é removido <b>na hora</b> e ele sai da hierarquia dos setores (gestor/equipe).<br>
     • As NCs e o histórico continuam com o nome dele — nada é apagado.<br>
     ${abertas ? `• <b class="txt-err">${abertas} NC(s) em aberto</b> estão sob responsabilidade dele: defina um novo responsável depois.<br>` : ''}
     <br><b>Esta ação não pode ser desfeita.</b> Se for algo temporário (férias, afastamento), prefira desmarcar <i>Usuário ativo</i>.`,
    'Excluir definitivamente');
  if (!ok) return;
  try {
    const r = await api('DELETE', '/users/' + x.id);
    toast(r.ncsAbertas ? `${x.nome} excluído. ${r.ncsAbertas} NC(s) em aberto precisam de novo responsável.` : `${x.nome} excluído.`, r.ncsAbertas ? 'info' : undefined);
  } catch (e) { toast(e.message, 'err'); }
  renderUsers();
}

/* =========================================================
   CONFIGURAÇÕES (admin)
   ========================================================= */
function renderConfig() {
  setTitle('Configurações');
  const c = S.cfg;
  const listCard = (key, title, sub) => `<div class="card"><h3>${title}</h3><p class="cfg-note">${sub}</p>
    <div class="chips">${c[key].map((x, i) => `<span class="chip">${esc(x)}<button data-act="del-list" data-k="${key}" data-i="${i}" aria-label="Remover">${icon('x')}</button></span>`).join('') || '<span class="muted" style="font-size:12.5px">Nenhum item</span>'}</div>
    <form class="addline" data-add="${key}"><input placeholder="Adicionar…" required><button class="btn btn-secondary">${icon('plus')}</button></form></div>`;
  $('#view').innerHTML = `
    <div class="cfg-grid">
      <div class="card"><h3>Numeração</h3>
        <p class="cfg-note">As NCs são numeradas automaticamente pelo servidor: PREFIXO-ANO-SEQUÊNCIA.</p>
        <div class="addline"><label class="fld" style="flex:1"><span>Prefixo</span><input id="cfg-pre" value="${esc(c.prefixo)}" maxlength="6"></label><button class="btn btn-primary" data-act="save-pre" style="align-self:flex-end">${icon('save')} Salvar</button></div>
        <p class="cfg-note" style="margin-top:10px;margin-bottom:0">Exemplo: <b style="color:var(--glow2)" id="cfg-ex">${esc(c.prefixo)}-${new Date().getFullYear()}-001</b></p>
      </div>
      <div class="card"><h3>${icon('db')} Dados e backup</h3>
        <p class="cfg-note">Os dados ficam no servidor (pasta <code>data</code>), com cópia automática diária em <code>data/backups</code>. Você também pode baixar um backup completo, com anexos, ou importar um backup — inclusive o da versão anterior de uso individual.</p>
        <div class="cfg-actions">
          <button class="btn btn-secondary" data-act="export-json">${icon('download')} Baixar backup (.json)</button>
          <button class="btn btn-secondary" data-act="import-json">${icon('upload')} Importar backup</button>
          <button class="btn btn-ghost" data-act="export-csv-all">${icon('sheet')} Exportar tudo p/ Excel</button>
          ${!S.ncs.length ? `<button class="btn btn-ghost" data-act="load-demo">${icon('db')} Carregar dados de exemplo</button>` : ''}
        </div>
        <p class="cfg-note" style="margin-top:14px;margin-bottom:0">${S.ncs.length} NC(s) no servidor.</p>
      </div>
      <div class="card span-cfg"><h3>Setores / áreas: gestor e equipe</h3>
        <p class="cfg-note">O <b>gestor da área</b> é quem <b>autoriza</b> as NCs do setor (depois a Qualidade age e encerra) e é sugerido como responsável ao registrar uma NC. A <b>equipe</b> pode tratar as NCs do seu setor. Gestor e equipe precisam ser usuários cadastrados. O <b>custo médio ADM / Operação</b> é usado como <b>prejuízo estimado</b> das NCs do setor quando ninguém informa um valor.</p>
        <div class="setor-tbl">
          <div class="setor-head"><span>Setor</span><span>Gestor da área</span><span>Equipe (usuários)</span><span>Custo médio ADM / Operação</span><span></span></div>
          ${c.setores.map((s, i) => {
            const g = (c.setorGestor || {})[s] || '';
            const orf = g && !S.pessoas.includes(g);
            const eq = (c.setorUsuarios || {})[s] || [];
            const livres = S.pessoas.filter(p => !eq.includes(p) && p !== g);
            return `<div class="setor-row"><span class="setor-nome">${esc(s)}</span>
              <select data-setor-gestor="${esc(s)}"><option value="">— sem gestor —</option>${S.pessoas.map(p => `<option ${p === g ? 'selected' : ''}>${esc(p)}</option>`).join('')}${orf ? `<option selected>${esc(g)} (inativo)</option>` : ''}</select>
              <div class="equipe">${eq.map(p => `<span class="chip">${esc(p)}<button data-act="del-equipe" data-setor="${esc(s)}" data-nome="${esc(p)}" aria-label="Remover da equipe">${icon('x')}</button></span>`).join('')}
                ${livres.length ? `<select data-setor-add="${esc(s)}"><option value="">+ adicionar usuário</option>${livres.map(p => `<option>${esc(p)}</option>`).join('')}</select>` : ''}</div>
              <div class="money-in" title="Custo médio ADM / Operação de uma NC deste setor"><i>R$</i><input type="text" data-setor-custo="${esc(s)}" data-money-cfg="1" value="${esc(moneyIn((c.setorCusto || {})[s] || ''))}" placeholder="0,00" inputmode="decimal" autocomplete="off"></div>
              <button class="icon-btn danger" data-act="del-list" data-k="setores" data-i="${i}" title="Remover setor">${icon('trash')}</button></div>`;
          }).join('')}
        </div>
        <form class="addline" data-add="setores" style="margin-top:12px"><input placeholder="Novo setor…" required><button class="btn btn-secondary">${icon('plus')}</button></form>
      </div>
      ${listCard('setores', 'Setor responsável pela NC', 'Opções do campo “Setor responsável pela NC”. É a mesma lista de Setores / áreas: ao adicionar aqui, o setor aparece na tabela acima para definir gestor, equipe e custo.')}
      ${listCard('origens', 'Origens', 'Como a NC foi detectada.')}
      ${listCard('responsaveis', 'Responsáveis externos', 'Pessoas sem acesso ao sistema que podem constar como responsáveis (os usuários já aparecem automaticamente).')}
    </div>`;
  $$('form[data-add]').forEach(fm => fm.addEventListener('submit', async e => {
    e.preventDefault();
    const k = fm.dataset.add, v = fm.querySelector('input').value.trim();
    if (v && !S.cfg[k].includes(v)) { await saveCfg({ [k]: [...S.cfg[k], v] }); renderConfig(); $(`form[data-add="${k}"] input`).focus(); }
  }));
  $$('[data-setor-gestor]').forEach(sel => sel.addEventListener('change', async () => {
    const s = sel.dataset.setorGestor, map = { ...(S.cfg.setorGestor || {}) };
    if (sel.value) map[s] = sel.value; else delete map[s];
    // o gestor não precisa constar também na equipe
    const eq = { ...(S.cfg.setorUsuarios || {}) };
    if (sel.value && (eq[s] || []).includes(sel.value)) eq[s] = eq[s].filter(p => p !== sel.value);
    if (await saveCfg({ setorGestor: map, setorUsuarios: eq })) { toast(sel.value ? `${s}: gestor ${sel.value}` : `${s}: sem gestor`); renderConfig(); }
  }));
  $$('[data-setor-add]').forEach(sel => sel.addEventListener('change', async () => {
    if (!sel.value) return;
    const s = sel.dataset.setorAdd, eq = { ...(S.cfg.setorUsuarios || {}) };
    eq[s] = [...(eq[s] || []), sel.value];
    if (await saveCfg({ setorUsuarios: eq })) { toast(`${sel.value} adicionado(a) à equipe de ${s}`); renderConfig(); }
  }));
  $$('[data-setor-custo]').forEach(inp => {
    inp.addEventListener('input', () => { const cl = inp.value.replace(/[^\d.,]/g, ''); if (cl !== inp.value) inp.value = cl; });
    inp.addEventListener('change', async () => {
      const s = inp.dataset.setorCusto, map = { ...(S.cfg.setorCusto || {}) };
      const v = parseMoney(inp.value);
      if (+v > 0) map[s] = v; else delete map[s];
      if (await saveCfg({ setorCusto: map })) { inp.value = moneyIn(map[s] || ''); toast(+v > 0 ? `${s}: custo médio ${money(v)}` : `${s}: sem custo médio`); }
    });
  });
  $('#cfg-pre').addEventListener('input', e => { $('#cfg-ex').textContent = `${e.target.value.trim().toUpperCase() || 'NC'}-${new Date().getFullYear()}-001`; });
  if (!isAdmin()) {   // Gestor: somente consulta
    $$('#view input, #view select, #view textarea, #view button').forEach(el => { el.disabled = true; });
    $$('#view .chip button, #view form.addline, #view .cfg-actions, #view [data-act="save-pre"]').forEach(el => el.remove());
    $('#view').insertAdjacentHTML('afterbegin', `<div class="banner mute" style="margin-bottom:14px">${icon('lock')}<div><b>Somente consulta.</b> Como Gestor, você vê todas as configurações, mas apenas o administrador pode alterá-las.</div></div>`);
  }
}
async function saveCfg(patch) {
  try { S.cfg = (await api('PUT', '/config', patch)).cfg; return true; } catch (e) { toast(e.message, 'err'); return false; }
}

/* ---------- Exportações ---------- */
function download(name, content, type) {
  const b = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}
function exportCSV(list) {
  const cols = [
    ['Número', n => n.numero], ['Data ocorrência', n => fmtD(n.dataOcorrencia)], ['Data registro', n => fmtD(n.dataRegistro)], ['Registrado por', n => n.criadoPor], ['Título', n => n.titulo],
    ['Descrição', n => n.descricao], ['Origem', n => n.origem], ['Setor responsável pela NC', n => n.setor],
    ['Severidade', n => SEV[n.severidade]?.label], ['Cliente / Fornecedor', n => n.cliente], ['Nº Pedido/NF/OC', n => n.os], ['Item', n => n.item], ['Quantidade', n => n.quantidade],
    ['Detectado por', n => n.detectadoPor], ['Responsável', n => n.responsavel], ['Prazo', n => fmtD(n.prazo)], ['Status', n => STATUS[n.status].label],
    ['Vencida', n => isOverdue(n) ? 'Sim' : 'Não'], ['Reincidente', n => n.reincidente === 'sim' ? 'Sim' : 'Não'], ['Justificativa do responsável', n => n.contencao?.descricao],
    ['Causa raiz', n => n.causa?.causaRaiz], ['Nº ações', n => (n.acoes || []).length], ['Ações concluídas', n => (n.acoes || []).filter(a => a.status === 'Concluída').length],
    ['Eficácia', n => n.eficacia?.resultado === 'eficaz' ? 'Eficaz' : n.eficacia?.resultado === 'ineficaz' ? 'Não eficaz' : 'Pendente'],
    ['Data encerramento', n => fmtD(n.encerramento?.data)], ['Encerrado por', n => n.encerramento?.por], ['Prejuízo estimado (R$)', n => (+n.custo || 0).toFixed(2).replace('.', ',')],
    ['Houve custo logístico?', n => n.custoLogHouve === 'sim' ? 'Sim' : n.custoLogHouve === 'nao' ? 'Não' : ''], ['Custo logístico (R$)', n => custoLogistico(n).toFixed(2).replace('.', ',')],
    ['Prejuízo total (R$)', n => custoTotal(n).toFixed(2).replace('.', ',')],
  ];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [cols.map(c => cell(c[0])).join(';'), ...list.map(n => cols.map(c => cell(c[1](n))).join(';'))].join('\r\n');
  download(`nao-conformidades_${todayISO()}.csv`, csv, 'text/csv;charset=utf-8');
  toast(`${list.length} registro(s) exportado(s)`);
}

/* ---------- Dados de exemplo ---------- */
function demoData() {
  const P = ['Carlos Mendes', 'Ana Paula Souza', 'Jorge Lima', 'Fernanda Rocha', 'Ricardo Alves', 'Patrícia Gomes'];
  const C = ['Siderúrgica Vale do Aço', 'Papel & Celulose Horizonte', 'Mineração Serra Alta', 'Alimentos Bom Grão', 'Química Paulista', ''];
  const R = [
    [250, 'encerrada', 'alta', 'Produto', 'Inspeção final', 'Usinagem', 'Diâmetro do eixo fora da tolerância após usinagem', 'Eixo de motor 250cv com diâmetro do assento do rolamento medido em Ø80,035 mm; especificado Ø80,000 +0,021/+0,002 (k6).', 'Peça segregada e identificada. Inspeção 100% das demais peças do lote.', 'Retrabalho', ['Ajuste incorreto do sobremetal no acabamento', 'Ferramenta com desgaste não detectado', 'Não há controle de vida útil do inserto', 'Procedimento não define troca preventiva'], 'Ausência de critério de troca preventiva de insertos de acabamento no torno CNC.', [['Implantar controle de vida útil de insertos por nº de peças', 'Corretiva'], ['Revisar IT-012 incluindo medição intermediária', 'Preventiva']], 1850, 30],
    [220, 'encerrada', 'critica', 'Produto', 'Inspeção em processo', 'Solda', 'Trinca em cordão de solda de flange', 'Ensaio por líquido penetrante revelou trinca linear de 12 mm na raiz do cordão da flange do redutor.', 'Remoção do cordão por goivagem e nova soldagem com inspeção LP.', 'Reparo', ['Pré-aquecimento não realizado', 'Soldador não tinha a EPS no posto', 'EPS arquivada apenas na engenharia', 'Falta de gestão de documentos no chão de fábrica'], 'EPS não disponível no posto de trabalho; pré-aquecimento omitido.', [['Disponibilizar EPS plastificada em cada box de solda', 'Corretiva'], ['Treinar soldadores na EPS-07', 'Corretiva'], ['Incluir verificação de pré-aquecimento no checklist', 'Preventiva']], 4200, 20],
    [190, 'encerrada', 'media', 'Fornecedor', 'Inspeção de recebimento', 'Almoxarifado', 'Material recebido sem certificado de qualidade', 'Barra de aço SAE 4140 recebida sem certificado de composição química e propriedades mecânicas.', 'Material bloqueado no almoxarifado até envio do certificado.', 'Devolução ao fornecedor', ['Fornecedor não enviou o certificado', 'Pedido de compra não exigia certificado'], 'Pedido de compra não especificava a exigência de certificado de material.', [['Incluir cláusula de certificado obrigatório no pedido de compra', 'Corretiva']], 0, 15],
    [160, 'encerrada', 'alta', 'Serviço', 'Reclamação de cliente', 'Bobinagem / Elétrica', 'Motor rebobinado com baixa resistência de isolamento', 'Cliente mediu resistência de isolamento de 5 MΩ na entrega; mínimo requerido 100 MΩ.', 'Motor recolhido, secagem em estufa e novo ensaio.', 'Retrabalho', ['Umidade no enrolamento', 'Tempo de cura do verniz insuficiente', 'Estufa com controlador descalibrado'], 'Controlador de temperatura da estufa descalibrado, resultando em cura incompleta do verniz.', [['Calibrar controlador da estufa', 'Corretiva'], ['Incluir estufa no plano de calibração anual', 'Preventiva'], ['Ensaio de isolamento obrigatório antes da expedição', 'Preventiva']], 3200, 15],
    [130, 'encerrada', 'baixa', 'Sistema de gestão', 'Auditoria interna', 'Qualidade', 'Registro de inspeção final não preenchido', 'Na auditoria interna, 4 de 20 OSs amostradas não possuíam registro de inspeção final assinado.', 'Registros recuperados junto aos inspetores.', 'Não aplicável', ['Inspetor esqueceu de preencher', 'Formulário em papel separado da OS'], 'Formulário de inspeção não integrado à pasta da OS.', [['Anexar formulário de inspeção à capa da OS', 'Corretiva']], 0, 30],
    [100, 'verificacao', 'media', 'Processo', 'Indicador de desempenho', 'Pintura', 'Espessura de camada de tinta abaixo do especificado', 'Medição de camada seca com média de 95 µm; especificação do cliente 120–150 µm.', 'Aplicação de demão adicional nas peças afetadas.', 'Retrabalho', ['Pistola com bico desgastado', 'Não há manutenção preventiva do equipamento de pintura'], 'Falta de manutenção preventiva da pistola airless.', [['Incluir pistolas no plano de manutenção preventiva', 'Corretiva'], ['Medição de camada a cada peça na liberação', 'Preventiva']], 980, 30],
    [75, 'acao', 'alta', 'Produto', 'Inspeção final', 'Balanceamento', 'Desbalanceamento residual acima do limite G2.5', 'Rotor de ventilador liberado com desbalanceamento residual de 18 g·mm/kg; limite G2.5 = 8 g·mm/kg.', 'Rotor rebalanceado antes do envio.', 'Retrabalho', ['Balanceadora com sensor descalibrado', 'Calibração vencida há 2 meses'], 'Sensor da balanceadora com calibração vencida.', [['Calibrar sensores da balanceadora', 'Corretiva'], ['Bloqueio de uso de equipamentos com calibração vencida', 'Preventiva']], 650, 40],
    [55, 'acao', 'media', 'Segurança do trabalho', 'Observação de campo', 'Caldeiraria', 'EPI não utilizado em atividade de esmerilhamento', 'Colaborador realizando esmerilhamento sem protetor facial.', 'Atividade paralisada e colaborador orientado.', 'Não aplicável', ['Protetor facial danificado', 'Não havia reposição no almoxarifado'], 'Estoque mínimo de EPIs não definido.', [['Definir estoque mínimo de protetores faciais', 'Corretiva'], ['DDS sobre uso de EPI em esmerilhamento', 'Preventiva']], 0, 25],
    [40, 'analise', 'critica', 'Reclamação de cliente', 'Reclamação de cliente', 'Montagem', 'Redutor com vazamento de óleo após 48 h de operação', 'Cliente relatou vazamento pelo retentor do eixo de saída após 48 h.', 'Técnico enviado a campo para substituição do retentor.', 'Reparo', ['Retentor montado invertido'], '', [], 2700, 20],
    [28, 'analise', 'media', 'Fornecedor', 'Inspeção de recebimento', 'Compras', 'Rolamento de marca divergente da especificada', 'Recebido rolamento de marca alternativa; cliente exige marca homologada.', 'Rolamentos bloqueados; solicitada troca ao fornecedor.', 'Devolução ao fornecedor', [], '', [], 0, 15],
    [18, 'aberta', 'alta', 'Produto', 'Inspeção em processo', 'Usinagem', 'Dimensional de flange divergente do desenho', 'Furação da flange com PCD 250 mm; desenho rev.B indica PCD 260 mm.', '', '', [], '', [], 0, 12],
    [10, 'aberta', 'baixa', 'Processo', 'Observação de campo', 'Expedição', 'Rosca danificada no transporte interno', 'Rosca M24 de eixo danificada durante movimentação com ponte rolante.', 'Rosca recuperada com cossinete.', 'Reparo', [], '', [], 120, 20],
    [5, 'aberta', 'media', 'Meio ambiente', 'Auditoria interna', 'Manutenção', 'Descarte inadequado de óleo usado', 'Tambor de óleo usado armazenado sem bacia de contenção.', '', '', [], '', [], 0, 15],
  ];
  const t = todayISO(); const counters = {};
  return R.sort((a, b) => b[0] - a[0]).map((r, idx) => {
    const [ago, st, sev, tipo, origem, setor, titulo, desc, cont, disp, pq, cr, ac, custo, pz] = r;
    const dt = addDays(t, -ago), y = dt.slice(0, 4);
    counters[y] = (counters[y] || 0) + 1;
    const resp = P[idx % P.length], det = P[(idx + 2) % P.length], si = FLOW.indexOf(st);
    const n = Object.assign(blankNC(), {
      id: 'demo' + uid() + idx, numero: `${S.cfg.prefixo || 'NC'}-${y}-${String(counters[y]).padStart(3, '0')}`,
      titulo, descricao: desc, dataOcorrencia: dt, dataRegistro: dt, tipo, origem, setor, severidade: sev,
      cliente: tipo === 'Reclamação de cliente' || tipo === 'Serviço' || idx % 3 === 0 ? C[idx % C.length] : '',
      os: `OS-${24000 + idx * 37}`, detectadoPor: det, criadoPor: det, responsavel: resp, prazo: addDays(dt, pz), custo: custo || '',
      reincidente: idx === 9 ? 'sim' : 'nao', status: st, createdAt: dt + 'T09:00:00.000Z',
    });
    n.historico = [{ data: dt + 'T09:00:00.000Z', usuario: det, acao: 'Não conformidade registrada' }];
    if (cont) n.contencao = { descricao: cont, responsavel: resp, data: addDays(dt, 1), disposicao: disp };
    if (pq.length) n.causa.porques = [...pq, '', '', '', '', ''].slice(0, 5);
    n.causa.causaRaiz = cr;
    n.acoes = ac.map(([o, tp], j) => {
      const done = si >= 3 || (st === 'acao' && j === 0);
      return Object.assign(blankAcao(), { descricao: o, tipo: tp, porque: 'Eliminar a causa raiz identificada', onde: setor, responsavel: P[(idx + j + 1) % P.length], prazo: addDays(dt, 10 + j * 7), como: 'Conforme procedimento interno', status: done ? 'Concluída' : j === 1 ? 'Em andamento' : 'Pendente', conclusao: done ? addDays(dt, 8 + j * 6) : '' });
    });
    FLOW.slice(1, si + 1).forEach((s, j) => n.historico.push({ data: addDays(dt, 2 + j * 8) + 'T14:00:00.000Z', usuario: resp, acao: `Status: ${STATUS[FLOW[j]].label} → ${STATUS[s].label}` }));
    if (st === 'encerrada') {
      const enc = addDays(dt, Math.min(ago - 2, 25 + idx * 3));
      n.eficacia = { resultado: 'eficaz', data: addDays(enc, -1), responsavel: 'Fernanda Rocha', evidencia: 'Acompanhamento dos lotes seguintes sem reincidência.' };
      n.encerramento = { data: enc, por: 'Fernanda Rocha', comentario: '' };
    }
    if (st === 'verificacao') n.eficacia = { resultado: '', data: '', responsavel: 'Fernanda Rocha', evidencia: '' };
    return n;
  });
}

/* =========================================================
   EVENTOS GLOBAIS
   ========================================================= */
function bindGlobal() {
  const view = $('#view');

  view.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.filter) { S.filters[el.dataset.filter] = el.value; renderTable(); return; }
    if ('dashPer' in el.dataset) { S.dashPer = el.value; renderDashboard(); return; }
    if (el.dataset.hf) { S.hf[el.dataset.hf] = el.value; drawHistoricos(); return; }
    if (el.dataset.logf) {   // filtros dos logs de acesso (busca com pequena espera enquanto digita)
      (S.logF ||= {})[el.dataset.logf] = el.value;
      clearTimeout(S.logT); S.logT = setTimeout(() => { const foco = el.dataset.logf; renderLogs().then(() => { const e2 = $(`[data-logf="${foco}"]`); if (e2 && foco === 'q') { e2.focus(); e2.setSelectionRange(e2.value.length, e2.value.length); } }); }, el.dataset.logf === 'q' ? 350 : 0);
      return;
    }
    if (el.dataset.kf) { S.kf[el.dataset.kf] = el.value; kfSave(); drawBoard(); return; }
    if (el.dataset.log) { S.logFilter[el.dataset.log] = el.value; renderLog(); return; }
    const f = el.dataset.f; if (!f || !S.draft || el.readOnly) return;
    if (el.dataset.money) {   // só aceita dígitos, ponto e vírgula
      const clean = el.value.replace(/[^\d.,]/g, '');
      if (clean !== el.value) el.value = clean;
    }
    if (el.dataset.upper && el.value !== el.value.toUpperCase()) {   // campos sempre em MAIÚSCULAS
      const p = el.selectionStart; el.value = el.value.toUpperCase(); try { el.setSelectionRange(p, p); } catch { }
    }
    setPath(S.draft, f, el.dataset.money ? parseMoney(el.value) : el.value);
    markDirty();
    el.closest('.fld')?.classList.remove('invalid');
    if (f === 'titulo') $('#ed-h2').textContent = el.value || 'Nova não conformidade';
    if (f === 'setor') applySetorResp(el.value);
    if (f === 'custo') delete S.draft._custoAuto;   // valor digitado pelo usuário prevalece
    if (f === 'custoLogHouve') { if (el.value !== 'sim') S.draft.custoLog = ''; refreshCustoLog(); if (el.value === 'sim') $('[data-f="custoLog"]')?.focus(); }
    if (f === 'custo' || f === 'custoLog') { const t = $('#custo-total'); if (t) t.innerHTML = custoTotalInfo(); }
    if (f === 'severidade') $('#ed-sev').innerHTML = pillSev(el.value);
    if (f === 'eficacia.resultado') refreshBar();
    const m = f.match(/^acoes\.(\d+)\.status$/);
    if (m) {
      const a = S.draft.acoes[+m[1]];
      if (a.status === 'Concluída' && !a.conclusao) a.conclusao = todayISO();
      $('#acoes-body').innerHTML = acoesHTML(); $('#acoes-prog').innerHTML = acaoProg(S.draft);
    }
  });

  view.addEventListener('change', e => {
    if (e.target.id === 'file-in') { addFiles([...e.target.files]); e.target.value = ''; }
  });

  document.addEventListener('click', async e => {
    if (!e.target.closest('.menu-wrap')) $('#more-menu')?.classList.remove('open');
    const t = e.target.closest('[data-act]'); if (!t) return;
    const act = t.dataset.act, d = S.draft;
    switch (act) {
      case 'open': location.hash = '#/nc/' + t.dataset.id; break;
      case 'goto-filter': gotoList(t.dataset.k, t.dataset.v); break;
      case 'ksort': e.stopPropagation(); kSortToggle(t.dataset.col); break;
      case 'hist-ord': S.hf.ord = S.hf.ord === 'asc' ? 'desc' : 'asc'; drawHistoricos(); break;
      case 'hist-csv': exportCSV(S.histList || []); break;
      case 'kf-clear': S.kf = KF_VAZIO(); kfSave(); renderKanban(); break;
      case 'sort': S.sort = { k: t.dataset.k, dir: S.sort.k === t.dataset.k ? -S.sort.dir : 1 }; renderTable(); break;
      case 'rm-filter': if (t.dataset.k === 'periodo') { S.filters.de = S.filters.ate = ''; } else S.filters[t.dataset.k] = ''; renderList(); break;
      case 'clear-filters': S.filters = emptyFilters(); renderList(); break;
      case 'export-csv': exportCSV(filtered()); break;
      case 'export-csv-all': exportCSV(S.ncs); break;
      case 'export-log': exportLog(d); break;
      case 'scroll': $('#' + t.dataset.to)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
      case 'logout': logout(); break;
      case 'change-pw': changePassword(); break;
      case 'add-acao': d.acoes.push(blankAcao()); $('#acoes-body').innerHTML = acoesHTML(); $('#acoes-prog').innerHTML = acaoProg(d); markDirty();
        $$('#acoes-body .acao').pop()?.querySelector('textarea')?.focus(); break;
      case 'del-acao': {
        const a = d.acoes[+t.dataset.i];
        if ((a.descricao || '').trim() && !(await confirmBox('Remover ação', `Remover a ação “${esc(a.descricao.slice(0, 80))}”?`, 'Remover', true))) break;
        d.acoes.splice(+t.dataset.i, 1); $('#acoes-body').innerHTML = acoesHTML(); $('#acoes-prog').innerHTML = acaoProg(d); markDirty(); break;
      }
      case 'del-pend': {   // remove um anexo ainda não enviado (NC em abertura)
        e.preventDefault(); (S.pendentes || []).splice(+t.dataset.i, 1);
        $('#anexos-body').innerHTML = anexosHTML(); bindDrop(); break;
      }
      case 'del-anexo': {
        e.stopPropagation(); e.preventDefault();
        const a = d.anexos.find(x => x.id === t.dataset.id); if (!a) break;
        if (!(await confirmBox('Remover anexo', `Remover “${esc(a.nome)}”? A remoção fica registrada no histórico.`, 'Remover', true))) break;
        try {
          await api('DELETE', '/anexos/' + a.id);
          d.anexos = d.anexos.filter(x => x.id !== a.id);
          const cached = S.ncs.find(n => n.id === d.id); if (cached) cached.anexos = [...d.anexos];
          $('#anexos-body').innerHTML = anexosHTML(); bindDrop(); toast('Anexo removido'); poll();
        } catch (err) { toast(err.message, 'err'); }
        break;
      }
      case 'view-anexo': { const a = d.anexos.find(x => x.id === t.dataset.id); a && openAnexo(a); break; }
      case 'save': saveDraft(); break;
      case 'save-rascunho': saveDraft({ rascunho: true }); break;
      case 'online-toggle': $('#online')?.classList.toggle('open'); break;
      case 'notif-toggle': $('#notif-popup')?.remove(); $('#notif')?.classList.toggle('open'); break;
      case 'notif-todas': notifMarcar({ todas: true }); break;
      case 'notif-fechar': $('#notif-popup')?.remove(); break;
      case 'notif-open': {
        $('#notif-popup')?.remove(); $('#notif')?.classList.remove('open');
        notifMarcar({ ids: [t.dataset.id] });
        if (t.dataset.nc) location.hash = '#/nc/' + t.dataset.nc;
        break;
      }
      case 'user-tab': S.userTab = t.dataset.tab; renderUsers(); break;
      case 'user-logs': S.userTab = 'logs'; S.logF = { user: t.dataset.id, tipo: '', de: '', ate: '', q: '' }; renderUsers(); break;
      case 'logs-csv': exportLogsCSV(); break;
      case 'advance': advance(); break;
      case 'reload-draft': { const srv = S.ncs.find(n => n.id === d.id); if (srv && (!S.dirty || confirm('Descartar suas alterações e carregar a versão atual?'))) loadDraft(srv); break; }
      case 'back-analise': {
        if (!(await confirmBox('Ação não eficaz', 'A NC voltará para <b>Em análise</b> para revisar a causa raiz e o plano de ação. O resultado da verificação fica registrado no histórico.', 'Retornar à análise'))) break;
        const ef = d.eficacia;
        const nota = `Verificação de eficácia: NÃO EFICAZ (${ef.responsavel || S.me.nome}${ef.data ? ', ' + fmtD(ef.data) : ''}) — ${ef.evidencia || 'sem evidência descrita'}`;
        d.eficacia = { resultado: '', data: '', responsavel: '', evidencia: '' };
        await changeStatus('analise', { nota, okMsg: 'NC retornou para análise' });
        if (S.draft === d && d.status !== 'analise') d.eficacia = ef;
        break;
      }
      case 'devolver': {
        const motivo = await askText('Devolver para análise', `Informe o que precisa ser revisto em <b>${esc(d.numero)}</b>. A NC volta para <b>Em análise</b>.`, 'Motivo da devolução');
        if (motivo == null) break;
        const quem = d.status === 'qualidade' ? 'Qualidade devolveu para análise' : 'Autorização negada — devolvida para análise';
        changeStatus('analise', { nota: quem + ': ' + (motivo || 'motivo não informado'), okMsg: `${d.numero} devolvida para análise` });
        break;
      }
      case 'reopen':
        changeStatus('analise', { confirmMsg: ['Reabrir não conformidade', `Reabrir <b>${esc(d.numero)}</b>? Ela voltará para a etapa <b>Em análise</b>.`, 'Reabrir'], okMsg: 'NC reaberta' });
        break;
      case 'more': $('#more-menu').classList.toggle('open'); break;
      case 'cancel-nc': {
        if (S.dirty && !(await saveDraft({ silent: true }))) break;
        const cur = S.ncs.find(n => n.id === d.id);
        if (await moveTo(cur, 'cancelada')) loadDraft(S.ncs.find(n => n.id === d.id));
        break;
      }
      case 'duplicate': {
        const c = normalizeNC(structuredClone(d));
        Object.assign(c, { id: '', numero: '', status: 'aberta', dataOcorrencia: todayISO(), historico: [], anexos: [], acoes: [], criadoPor: '', criadoPorId: null, version: undefined,
          contencao: { descricao: '', responsavel: '', data: '', disposicao: '' }, causa: { porques: ['', '', '', '', ''], ishikawa: {}, causaRaiz: '' },
          eficacia: { resultado: '', data: '', responsavel: '', evidencia: '' }, encerramento: { data: '', por: '', comentario: '' }, ncRelacionada: d.numero, detectadoPor: S.me.nome });
        if (S.dirty && !confirm('Descartar alterações não salvas desta NC?')) break;
        S.dirty = false; S.skip = true; location.hash = '#/nova'; S.lastHash = '#/nova';
        S.isNew = true; S.draft = c; markNav(); drawEditor(); window.scrollTo(0, 0); toast('Cópia criada — revise e registre', 'info');
        break;
      }
      case 'delete':
        if (await confirmBox('Excluir definitivamente', `Excluir <b>${esc(d.numero)}</b> e todos os seus anexos? <br><br><b style="color:var(--err)">Esta ação não pode ser desfeita.</b> Para manter o registro, prefira “Cancelar NC”.`, 'Excluir', true)) {
          try { await api('DELETE', '/ncs/' + d.id); } catch (err) { toast(err.message, 'err'); break; }
          S.ncs = S.ncs.filter(n => n.id !== d.id); S.dirty = false; renderNav(); toast(`${d.numero} excluída`); location.hash = '#/ncs';
        }
        break;
      case 'print':
        if (S.dirty) {
          if (!(await confirmBox('Alterações não salvas', 'Salvar antes de imprimir?', 'Salvar e imprimir'))) break;
          if (!(await saveDraft({ silent: true }))) break;
        }
        printNC(S.draft); break;
      case 'print-go': window.print(); break;
      case 'toggle-theme': toggleTheme(); break;
      case 'print-close': closePrint(); break;
      case 'save-pre':
        if (await saveCfg({ prefixo: $('#cfg-pre').value })) { toast('Prefixo salvo'); renderConfig(); }
        break;
      case 'del-list': {
        const k = t.dataset.k, nome = S.cfg[k][+t.dataset.i], list = S.cfg[k].filter((_, i) => i !== +t.dataset.i);
        if (k === 'setores') {
          const usado = S.ncs.filter(n => n.setor === nome).length;
          if (!(await confirmBox('Remover setor', `Remover o setor <b>${esc(nome)}</b>? Ele deixa de aparecer no campo “Setor responsável pela NC”, e o gestor, a equipe e o custo médio dele são apagados.${usado ? `<br><br>As ${usado} NC(s) já registradas com esse setor continuam como estão.` : ''}`, 'Remover', true))) break;
          // o servidor já limpa gestor, equipe e custo de setores que saíram da lista
          if (await saveCfg({ setores: list })) { toast(`Setor ${nome} removido`); renderConfig(); }
          break;
        }
        if (await saveCfg({ [k]: list })) renderConfig();
        break;
      }
      case 'del-equipe': {
        const s = t.dataset.setor, eq = { ...(S.cfg.setorUsuarios || {}) };
        eq[s] = (eq[s] || []).filter(p => p !== t.dataset.nome);
        if (await saveCfg({ setorUsuarios: eq })) renderConfig();
        break;
      }
      case 'user-new': userNew(); break;
      case 'user-edit': userEdit(t.dataset.id); break;
      case 'user-del': { const id = t.dataset.id; $('#modal-root [data-x]')?.click(); setTimeout(() => userDelete(id), 50); break; }
      case 'export-json': window.location.href = apiURL('/backup'); toast('Gerando backup…', 'info'); break;
      case 'import-json': $('#import-file').click(); break;
      case 'load-demo': {
        if (!isAdmin()) break;
        try {
          const r = await api('POST', '/import', { app: 'melting-nc', ncs: demoData() });
          const b = await api('GET', '/bootstrap'); S.ncs = b.ncs; S.rev = b.rev; renderNav();
          toast(`${r.importadas} NCs de exemplo carregadas`);
          if (location.hash === '#/painel') renderDashboard(); else location.hash = '#/painel';
        } catch (err) { toast(err.message, 'err'); }
        break;
      }
    }
  });

  $('#import-file').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'melting-nc' || !Array.isArray(data.ncs)) throw new Error('Arquivo não é um backup deste sistema');
      if (!(await confirmBox('Importar backup', `O arquivo contém <b>${data.ncs.length} NC(s)</b>. Registros com o mesmo identificador serão substituídos; os demais serão mantidos. Números repetidos recebem nova numeração.`, 'Importar'))) return;
      const r = await api('POST', '/import', data);
      const b = await api('GET', '/bootstrap'); S.ncs = b.ncs; S.cfg = b.cfg; S.rev = b.rev; renderNav();
      toast(`${r.importadas} NC(s) importada(s)`); route();
    } catch (err) { toast('Falha ao importar: ' + err.message, 'err'); }
  });

  $('#menu-btn').innerHTML = icon('menu');
  const desktop = () => window.matchMedia('(min-width: 961px)').matches;
  const setCollapsed = on => {
    document.body.classList.toggle('nav-collapsed', on);
    $('#menu-btn').title = on ? 'Mostrar menu lateral' : 'Ocultar menu lateral';
    try { localStorage.setItem('nc-nav-collapsed', on ? '1' : '0'); } catch { /* sem armazenamento */ }
  };
  let saved = false; try { saved = localStorage.getItem('nc-nav-collapsed') === '1'; } catch { /* ignora */ }
  setCollapsed(saved);
  $('#menu-btn').addEventListener('click', () => {
    if (desktop()) setCollapsed(!document.body.classList.contains('nav-collapsed'));
    else document.body.classList.toggle('nav-open');
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b' && desktop()) { e.preventDefault(); setCollapsed(!document.body.classList.contains('nav-collapsed')); }
  });
  $('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
  $('#top-new').innerHTML = icon('plus') + '<span>Nova NC</span>';

  window.addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && S.draft) { e.preventDefault(); if (editable()) saveDraft(); }
  });
  window.addEventListener('hashchange', route);
}

/* ---------- Início ---------- */
async function init() {
  bindGlobal();
  try {
    const st = await api('GET', '/status');
    if (st.setup) return showAuth('setup');
    await boot();
  } catch (e) {
    if (e.status === 401) showAuth('login');
    else showAuth('login', e.message);
  }
}
init();
