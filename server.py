#!/usr/bin/env python3
"""
Melting · Gestão de Não Conformidades — servidor multiusuário.

Usa somente a biblioteca padrão do Python (3.9+): nada para instalar.
    python server.py                 # porta 8080
    python server.py --port 9000     # outra porta
Os dados ficam em ./data/melting-nc.db (SQLite) com backup diário em ./data/backups.
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import socket
import sqlite3
import sys
import threading
import time
import traceback
from contextlib import contextmanager
from datetime import date, datetime, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

VERSAO = '2.0'
BASE = Path(__file__).resolve().parent
PUBLIC = BASE / 'public'
SESSION_DAYS = 14
MAX_BODY = 25 * 1024 * 1024
MAX_FILE = 8 * 1024 * 1024
FILE_TYPES = {'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'}

# Plano de ação (5W2H) e verificação de eficácia desativados por enquanto (fluxo simplificado).
# Para reativar: True aqui e PLANO_ACAO = true no public/app.js.
PLANO_ACAO = False
FLOW = (['aberta', 'analise', 'acao', 'verificacao', 'autorizacao', 'qualidade', 'encerrada'] if PLANO_ACAO
        else ['aberta', 'analise', 'autorizacao', 'qualidade', 'encerrada'])
STATUS_LABEL = {'aberta': 'Rascunho', 'analise': 'Em análise', 'acao': 'Ação em andamento',
                'verificacao': 'Verificação de eficácia', 'autorizacao': 'Aguardando autorização', 'qualidade': 'Qualidade',
                'encerrada': 'Encerrada', 'cancelada': 'Cancelada'}
ENCERRA = ('admin', 'gestor', 'qualidade')   # perfis que encerram a NC (depois da etapa "Qualidade")
PERFIS = ('admin', 'gestor', 'qualidade', 'colaborador')
VE_TUDO = ('admin', 'gestor')   # gestor: vê todo o cenário (como o admin), mas sem poderes de administração
VE_TODAS_NCS = ('admin', 'gestor', 'qualidade')   # enxergam todas as NCs; o colaborador vê só as dele
GESTAO = ('admin', 'qualidade')
REQUIRED = [('titulo', 'Título'), ('descricao', 'Descrição'), ('dataOcorrencia', 'Data da ocorrência'),
            ('setor', 'Setor responsável pela NC'), ('responsavel', 'Responsável'), ('severidade', 'Severidade'),
            ('cliente', 'Cliente / Fornecedor'), ('origem', 'Origem / como foi detectada')]
MANAGED = {'id', 'numero', 'status', 'version', 'updatedAt', 'anexos', 'historico', 'criadoPor', 'criadoPorId',
           'createdAt', 'dataRegistro', 'encerramento'}
DEFAULT_CFG = {
    'prefixo': 'NC',
    'setores': ['Usinagem', 'Caldeiraria', 'Solda', 'Montagem', 'Bobinagem / Elétrica', 'Balanceamento', 'Pintura',
                'Serviço de campo', 'Almoxarifado', 'Expedição', 'Engenharia', 'Qualidade', 'Compras', 'Comercial', 'SESMT'],
    'tipos': ['Produto', 'Processo', 'Serviço', 'Sistema de gestão', 'Fornecedor', 'Reclamação de cliente',
              'Segurança do trabalho', 'Meio ambiente'],
    'origens': ['Inspeção de recebimento', 'Inspeção em processo', 'Inspeção final', 'Auditoria interna',
                'Auditoria externa / certificação', 'Reclamação de cliente', 'Observação de campo', 'Indicador de desempenho'],
    'disposicoes': ['Retrabalho', 'Reparo', 'Uso como está (concessão do cliente)', 'Reclassificação', 'Sucata',
                    'Devolução ao fornecedor', 'Não aplicável'],
    'responsaveis': [],
    'setorResp': {},   # (legado) substituído por setorGestor
    'setorGestor': {},    # setor -> nome do usuário gestor da área (encerra as NCs do setor)
    'setorUsuarios': {},  # setor -> [nomes dos usuários da área]
    'setorCusto': {},     # setor -> custo médio de uma NC ("1234.00"), usado como prejuízo estimado padrão
}
CONTENT_TYPES = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                 '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
                 '.json': 'application/json', '.webmanifest': 'application/manifest+json'}

DB_PATH: Path = None  # definido em main()
LOGIN_FAILS = {}
LOGIN_LOCK = threading.Lock()


# ---------------------------------------------------------------- utilidades
def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def today():
    return date.today().isoformat()


def norm(s):
    return str(s or '').strip().lower()


class ApiError(Exception):
    def __init__(self, status, msg, **extra):
        super().__init__(msg)
        self.status, self.msg, self.extra = status, msg, extra


def db():
    con = sqlite3.connect(DB_PATH, timeout=20, isolation_level=None)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    con.execute('PRAGMA busy_timeout=20000')
    return con


@contextmanager
def tx(con):
    con.execute('BEGIN IMMEDIATE')
    try:
        yield
        con.execute('COMMIT')
    except BaseException:
        con.execute('ROLLBACK')
        raise


SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, login TEXT NOT NULL UNIQUE COLLATE NOCASE, email TEXT DEFAULT '',
  senha TEXT NOT NULL, perfil TEXT NOT NULL, ativo INTEGER NOT NULL DEFAULT 1, trocar_senha INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL, ultimo_acesso TEXT);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expira REAL NOT NULL);
CREATE TABLE IF NOT EXISTS ncs(
  id TEXT PRIMARY KEY, numero TEXT NOT NULL UNIQUE, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  rev INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_ncs_rev ON ncs(rev);
CREATE TABLE IF NOT EXISTS anexos(
  id TEXT PRIMARY KEY, nc_id TEXT NOT NULL REFERENCES ncs(id) ON DELETE CASCADE, nome TEXT NOT NULL, tipo TEXT NOT NULL,
  tamanho INTEGER NOT NULL, conteudo BLOB NOT NULL, criado_em TEXT NOT NULL, por TEXT);
CREATE INDEX IF NOT EXISTS ix_anexos_nc ON anexos(nc_id);
CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auditoria(
  id INTEGER PRIMARY KEY, data TEXT NOT NULL, user_id INTEGER, usuario TEXT NOT NULL DEFAULT '', login TEXT DEFAULT '',
  tipo TEXT NOT NULL, acao TEXT NOT NULL, detalhe TEXT DEFAULT '', ref TEXT DEFAULT '', ip TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_aud_data ON auditoria(data);
CREATE INDEX IF NOT EXISTS ix_aud_user ON auditoria(user_id);
CREATE TABLE IF NOT EXISTS notificacoes(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, data TEXT NOT NULL, titulo TEXT NOT NULL, texto TEXT DEFAULT '',
  nc_id TEXT DEFAULT '', ref TEXT DEFAULT '', de TEXT DEFAULT '', lida INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notificacoes(user_id, id);
"""


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = db()
    con.execute('PRAGMA journal_mode=WAL')
    con.executescript(SCHEMA)
    con.close()


def next_rev(con):
    con.execute("INSERT INTO kv(k,v) VALUES('rev','1') ON CONFLICT(k) DO UPDATE SET v=CAST(v AS INTEGER)+1")
    return int(con.execute("SELECT v FROM kv WHERE k='rev'").fetchone()[0])


def cur_rev(con):
    r = con.execute("SELECT v FROM kv WHERE k='rev'").fetchone()
    return int(r[0]) if r else 0


def get_cfg(con):
    r = con.execute("SELECT v FROM kv WHERE k='cfg'").fetchone()
    cfg = json.loads(json.dumps(DEFAULT_CFG))
    if r:
        cfg.update(json.loads(r[0]))
    return cfg


# ---------------------------------------------------------------- senhas
def hash_pw(pw):
    salt = secrets.token_bytes(16)
    it = 240_000
    h = hashlib.pbkdf2_hmac('sha256', pw.encode(), salt, it)
    return f'pbkdf2${it}${salt.hex()}${h.hex()}'


def check_pw(pw, stored):
    try:
        _, it, salt, h = stored.split('$')
        calc = hashlib.pbkdf2_hmac('sha256', pw.encode(), bytes.fromhex(salt), int(it)).hex()
        return hmac.compare_digest(calc, h)
    except Exception:
        return False


def temp_password():
    alfabeto = 'abcdefghjkmnpqrstuvwxyz23456789'
    return ''.join(secrets.choice(alfabeto) for _ in range(4)) + '-' + ''.join(secrets.choice(alfabeto) for _ in range(4))


def validate_pw(pw):
    if len(pw or '') < 6:
        raise ApiError(422, 'A senha deve ter pelo menos 6 caracteres.')


# ---------------------------------------------------------------- usuários
def user_out(r, full=False):
    u = {'id': r['id'], 'nome': r['nome'], 'login': r['login'], 'perfil': r['perfil'], 'email': r['email'] or '',
         'trocarSenha': bool(r['trocar_senha'])}
    if full:
        u.update(ativo=bool(r['ativo']), criadoEm=r['criado_em'], ultimoAcesso=r['ultimo_acesso'])
    return u


def pessoas(con):
    return [r[0] for r in con.execute('SELECT nome FROM users WHERE ativo=1 ORDER BY nome COLLATE NOCASE')]


def new_session(con, user_id):
    token = secrets.token_urlsafe(32)
    con.execute('INSERT INTO sessions(token,user_id,expira) VALUES(?,?,?)', (token, user_id, time.time() + SESSION_DAYS * 86400))
    con.execute('DELETE FROM sessions WHERE expira<?', (time.time(),))
    con.execute('UPDATE users SET ultimo_acesso=? WHERE id=?', (now_iso(), user_id))
    return token


# ---------------------------------------------------------------- auditoria (logs de acesso e alterações)
AUD_TIPOS = ('Acesso', 'NC', 'Usuários', 'Configurações')


def audit(con, h, user, tipo, acao, detalhe='', ref='', login=''):
    """Registra um evento na trilha de auditoria (não quebra a operação se falhar)."""
    try:
        ip = h.client_address[0] if h is not None else ''
        con.execute('INSERT INTO auditoria(data,user_id,usuario,login,tipo,acao,detalhe,ref,ip) VALUES(?,?,?,?,?,?,?,?,?)',
                    (now_iso(), user['id'] if user else None, user['nome'] if user else '', (user['login'] if user else login) or '',
                     tipo, str(acao)[:300], str(detalhe or '')[:4000], str(ref or '')[:60], ip))
    except Exception:
        traceback.print_exc()


def resumo_alteracoes(alt, limite=12):
    if not alt:
        return ''
    itens = [f"{a.get('campo')}: {a.get('de') or 'vazio'} → {a.get('para') or 'vazio'}" for a in alt[:limite]]
    return '; '.join(itens) + (f' (+{len(alt) - limite} campo(s))' if len(alt) > limite else '')


# ---------------------------------------------------------------- notificações
def notificar(con, actor, nomes, titulo, texto='', nc_id='', ref=''):
    """Cria notificação para os usuários (por nome, só ativos), exceto para quem fez a ação."""
    alvo = {norm(n) for n in nomes if str(n or '').strip()}
    if not alvo:
        return
    for r in con.execute('SELECT id, nome FROM users WHERE ativo=1').fetchall():
        if norm(r['nome']) in alvo and (actor is None or r['id'] != actor['id']):
            con.execute('INSERT INTO notificacoes(user_id,data,titulo,texto,nc_id,ref,de) VALUES(?,?,?,?,?,?,?)',
                        (r['id'], now_iso(), titulo[:200], str(texto or '')[:500], nc_id, ref, actor['nome'] if actor else ''))


def nomes_perfil(con, perfil):
    return [r[0] for r in con.execute('SELECT nome FROM users WHERE ativo=1 AND perfil=?', (perfil,))]


def notificar_etapa(con, actor, d, nc_id, numero, frm, to, cfg):
    """Avisa quem precisa agir quando a NC muda de etapa."""
    tit = d.get('titulo') or ''
    if to == 'analise' and frm == 'aberta':
        notificar(con, actor, [d.get('responsavel')], f'Nova NC para você tratar: {numero}', tit, nc_id, numero)
    elif to == 'analise' and frm in ('autorizacao', 'qualidade'):
        notificar(con, actor, [d.get('responsavel')], f'{numero} foi devolvida para análise', tit, nc_id, numero)
    elif to == 'autorizacao':
        g = gestor_setor(cfg, d.get('setor'))
        notificar(con, actor, [g] if g else nomes_perfil(con, 'qualidade'), f'{numero} aguarda a sua autorização', tit, nc_id, numero)
    elif to == 'qualidade':
        notificar(con, actor, nomes_perfil(con, 'qualidade'), f'{numero} autorizada: ação da Qualidade', tit, nc_id, numero)
    elif to == 'encerrada':
        notificar(con, actor, [d.get('responsavel'), d.get('criadoPor')], f'{numero} foi encerrada', tit, nc_id, numero)


def notif_resumo(con, user):
    rows = con.execute('SELECT * FROM notificacoes WHERE user_id=? ORDER BY id DESC LIMIT 40', (user['id'],)).fetchall()
    nao = con.execute('SELECT COUNT(*) FROM notificacoes WHERE user_id=? AND lida=0', (user['id'],)).fetchone()[0]
    return {'naoLidas': nao, 'lista': [{k: r[k] for k in ('id', 'data', 'titulo', 'texto', 'nc_id', 'ref', 'de')} | {'lida': bool(r['lida'])} for r in rows]}


# ---------------------------------------------------------------- usuários online (em memória)
ONLINE = {}                 # user_id -> (último acesso, nome, perfil)
ONLINE_LOCK = threading.Lock()
ONLINE_JANELA = 90          # segundos sem atividade para sair da lista (o navegador consulta a cada 15 s)


def marca_online(u):
    with ONLINE_LOCK:
        ONLINE[u['id']] = (time.time(), u['nome'], u['perfil'])


def online_list():
    agora = time.time()
    with ONLINE_LOCK:
        for uid in [k for k, v in ONLINE.items() if agora - v[0] > ONLINE_JANELA]:
            ONLINE.pop(uid, None)
        return sorted(({'id': k, 'nome': v[1], 'perfil': v[2]} for k, v in ONLINE.items()), key=lambda x: norm(x['nome']))


def active_admins(con, excluding=None):
    q = "SELECT COUNT(*) FROM users WHERE perfil='admin' AND ativo=1"
    args = ()
    if excluding is not None:
        q += ' AND id<>?'
        args = (excluding,)
    return con.execute(q, args).fetchone()[0]


# ---------------------------------------------------------------- NCs
def anexos_meta(con, nc_ids=None):
    q = 'SELECT id,nc_id,nome,tipo,tamanho,criado_em,por FROM anexos'
    rows = con.execute(q + ' ORDER BY criado_em').fetchall() if nc_ids is None else \
        con.execute(q + f" WHERE nc_id IN ({','.join('?' * len(nc_ids))}) ORDER BY criado_em", nc_ids).fetchall()
    out = {}
    for r in rows:
        out.setdefault(r['nc_id'], []).append({'id': r['id'], 'nome': r['nome'], 'tipo': r['tipo'], 'tamanho': r['tamanho'],
                                               'em': r['criado_em'], 'por': r['por']})
    return out


def nc_out(row, anx):
    d = json.loads(row['data'])
    d.update(id=row['id'], numero=row['numero'], status=row['status'], version=row['version'], updatedAt=row['updated_at'])
    d['anexos'] = anx.get(row['id'], [])
    return d


def load_nc(con, nc_id):
    row = con.execute('SELECT * FROM ncs WHERE id=?', (nc_id,)).fetchone()
    if not row:
        raise ApiError(404, 'Não conformidade não encontrada (pode ter sido excluída).')
    return row


def clean(nc):
    if not isinstance(nc, dict):
        raise ApiError(400, 'Dados inválidos.')
    d = {k: v for k, v in nc.items() if k not in MANAGED and not str(k).startswith('_')}
    if len(json.dumps(d)) > 1_500_000:
        raise ApiError(413, 'Registro muito grande.')
    if not isinstance(d.get('acoes', []), list):
        d['acoes'] = []
    for k in ('cliente', 'titulo'):   # Cliente e Título sempre em MAIÚSCULAS
        if isinstance(d.get(k), str):
            d[k] = d[k].strip().upper()
    return d


def content_key(d):
    x = {k: v for k, v in d.items() if k not in MANAGED}
    x['_comentario'] = (d.get('encerramento') or {}).get('comentario', '')
    return json.dumps(x, sort_keys=True, ensure_ascii=False)


def check_custo_log(d, nova=False):
    """Custo logístico: na abertura é preciso responder Sim/Não; se Sim, o valor é obrigatório."""
    h = d.get('custoLogHouve') or ''
    if nova and h not in ('sim', 'nao'):
        raise ApiError(422, 'Informe se houve custo logístico (Sim ou Não).', campos=['custoLogHouve'])
    if h == 'sim' and not _num(d.get('custoLog')) > 0:
        raise ApiError(422, 'Informe o valor do custo logístico.', campos=['custoLog'])
    if h != 'sim' and d.get('custoLog'):
        d['custoLog'] = ''


SEV_VALIDAS = ('baixa', 'media', 'alta')   # "critica" saiu de uso; NCs antigas com ela continuam como estão


def check_severidade(d, old=None):
    s = d.get('severidade') or ''
    if s and s not in SEV_VALIDAS and not (old is not None and old.get('severidade') == s):
        raise ApiError(422, 'Severidade inválida: use Baixa, Média ou Alta.', campos=['severidade'])


def check_rascunho(con, d, old=None):
    """Rascunho (status "aberta"): só o título é obrigatório; o resto é cobrado ao enviar para análise."""
    if not str(d.get('titulo') or '').strip():
        raise ApiError(422, 'Para salvar o rascunho, informe ao menos o título.', campos=['titulo'])
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', str(d.get('dataOcorrencia') or '')):
        d['dataOcorrencia'] = today()
    check_severidade(d, old)
    if str(d.get('responsavel') or '').strip():
        check_responsavel(con, d, old)
    if (d.get('custoLogHouve') or '') == 'sim' and not _num(d.get('custoLog')) > 0:
        raise ApiError(422, 'Informe o valor do custo logístico.', campos=['custoLog'])


def check_required(d):
    falta = [(f, l) for f, l in REQUIRED if not str(d.get(f) or '').strip()]
    if falta:
        raise ApiError(422, 'Preencha: ' + ', '.join(l for _, l in falta), campos=[f for f, _ in falta])
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', str(d.get('dataOcorrencia'))):
        raise ApiError(422, 'Data da ocorrência inválida.', campos=['dataOcorrencia'])


def check_responsavel(con, d, old=None):
    """O responsável pela NC deve ser um usuário ativo (exigido em NCs novas e quando o responsável é trocado)."""
    if old is not None and norm(old.get('responsavel')) == norm(d.get('responsavel')):
        return
    if str(d.get('responsavel') or '').strip() not in set(pessoas(con)):
        raise ApiError(422, 'O responsável pela NC deve ser um usuário cadastrado e ativo no sistema.', campos=['responsavel'])


def missing_for(d, status):
    m = []
    acoes = d.get('acoes') or []
    if status == 'aberta':
        pass   # quem abre só registra; a justificativa é do responsável, na etapa "Em análise"
    elif status == 'qualidade':
        if not str(d.get('qualidadeAcao') or '').strip():
            m.append('Descreva a ação da Qualidade para resolver a não conformidade (seção Encerramento).')
    elif status == 'analise':
        if not str((d.get('contencao') or {}).get('descricao') or '').strip():
            m.append('Preencha a justificativa do responsável (seção 3).')
        if not str((d.get('causa') or {}).get('causaRaiz') or '').strip():
            m.append('Informe a causa raiz (seção 4).')
        if not PLANO_ACAO:
            pass
        elif not acoes:
            m.append('Cadastre ao menos uma ação no plano de ação (seção 4).')
        elif any(not str(a.get('descricao') or '').strip() or not str(a.get('responsavel') or '').strip() or not a.get('prazo') for a in acoes):
            m.append('Preencha O quê, Quem e Quando de todas as ações.')
    elif status == 'acao':
        if any(a.get('status') != 'Concluída' for a in acoes):
            m.append('Todas as ações do plano precisam estar concluídas.')
    elif status == 'verificacao':
        ef = d.get('eficacia') or {}
        if ef.get('resultado') != 'eficaz':
            m.append('Registre a verificação de eficácia como "Eficaz" (seção 5).')
        if not str(ef.get('evidencia') or '').strip():
            m.append('Descreva a evidência que comprova a eficácia.')
    return m


def gestor_setor(cfg, setor):
    return str(((cfg or {}).get('setorGestor') or {}).get(setor or '') or '')


def do_setor(cfg, setor, nome):
    """Usuário é o gestor ou faz parte da equipe do setor."""
    nm = norm(nome)
    if not nm or not setor:
        return False
    equipe = ((cfg or {}).get('setorUsuarios') or {}).get(setor) or []
    return nm == norm(gestor_setor(cfg, setor)) or any(nm == norm(x) for x in equipe)


def pode_encerrar(user, d, cfg):
    """Encerramento: gestor da área da NC. O administrador pode sempre; sem gestor definido, a Qualidade também."""
    if user['perfil'] == 'admin':
        return True
    g = gestor_setor(cfg, d.get('setor'))
    if g:
        return norm(user['nome']) == norm(g)
    return user['perfil'] in GESTAO


def can_view(user, d, status, cfg=None):
    """Visibilidade: o administrador vê todo o cenário; os demais veem só as NCs que são deles —
    responsável, quem registrou, responsável por alguma ação, gestor da área ou quem precisa autorizar o encerramento."""
    if user['perfil'] in VE_TODAS_NCS:
        return True
    if d.get('criadoPorId') == user['id']:
        return True
    if status == 'aberta':   # rascunho: só quem abriu (e Administrador, Gestor e Qualidade)
        return False
    nm = norm(user['nome'])
    if nm == norm(d.get('responsavel')) or any(nm == norm(a.get('responsavel')) for a in d.get('acoes') or []):
        return True
    g = gestor_setor(cfg, d.get('setor'))
    if g and nm == norm(g):
        return True
    return status == 'autorizacao' and pode_encerrar(user, d, cfg)


def visiveis(con, user, rows, cfg=None):
    if user['perfil'] in VE_TODAS_NCS:
        return list(rows)
    cfg = cfg or get_cfg(con)
    return [r for r in rows if can_view(user, json.loads(r['data']), r['status'], cfg)]


def load_visivel(con, user, nc_id, cfg=None):
    row = load_nc(con, nc_id)
    if not can_view(user, json.loads(row['data']), row['status'], cfg or get_cfg(con)):
        raise ApiError(404, 'Não conformidade não encontrada (ou você não tem acesso a ela).')
    return row


def can_edit(user, d, status, cfg=None):
    if user['perfil'] in GESTAO:
        return True
    if status in ('encerrada', 'cancelada'):
        return False
    if status == 'qualidade' and user['perfil'] in ENCERRA:   # o Gestor registra a ação da Qualidade e encerra
        return True
    if d.get('criadoPorId') == user['id']:
        return True
    if status == 'aberta':   # rascunho: só quem abriu edita
        return False
    nm = norm(user['nome'])
    return (nm == norm(d.get('responsavel')) or any(nm == norm(a.get('responsavel')) for a in d.get('acoes') or [])
            or do_setor(cfg, d.get('setor'), user['nome']))


def check_transition(user, d, frm, to, cfg=None):
    if frm == to:
        return
    if to not in STATUS_LABEL:
        raise ApiError(400, 'Status inválido.')
    gestao = user['perfil'] in GESTAO
    if to == 'cancelada':
        if user['perfil'] != 'admin':
            raise ApiError(403, 'Somente o administrador pode cancelar uma NC.')
        return
    if frm in ('encerrada', 'cancelada'):
        if not gestao:
            raise ApiError(403, 'Somente Qualidade ou Administrador podem reabrir uma NC.')
        if to == 'encerrada':
            raise ApiError(422, 'Reabra a NC antes de encerrá-la novamente.')
        return
    if to not in FLOW:
        raise ApiError(422, f'A etapa "{STATUS_LABEL[to]}" não está em uso.')
    # NC que estava numa etapa desativada conta como "Em análise"
    fi, ti = FLOW.index(frm) if frm in FLOW else FLOW.index('analise'), FLOW.index(to)
    if ti > fi:
        for i in range(fi, ti):
            m = missing_for(d, FLOW[i])
            if m:
                raise ApiError(422, f'Pendências na etapa "{STATUS_LABEL[FLOW[i]]}".', pendencias=m, etapa=FLOW[i])
        # sair de "Aguardando autorização" = autorizar: gestor da área (admin sempre; sem gestor, a Qualidade)
        ia = FLOW.index('autorizacao')
        if fi <= ia < ti and not pode_encerrar(user, d, cfg):
            g = gestor_setor(cfg, d.get('setor'))
            raise ApiError(403, f'A autorização desta NC é feita pelo gestor da área ({g}).' if g else
                           'A autorização é feita pelo gestor da área. Este setor ainda não tem gestor definido — peça ao administrador para defini-lo em Configurações.')
        # encerrar (sair de "Qualidade"): somente Qualidade, Gestor ou Administrador
        if to == 'encerrada' and user['perfil'] not in ENCERRA:
            raise ApiError(403, 'O encerramento é feito pela Qualidade (perfis Qualidade, Gestor ou Administrador).')
    elif not gestao and not (frm == 'verificacao' and to == 'analise') \
            and not (frm == 'autorizacao' and pode_encerrar(user, d, cfg)) \
            and not (frm == 'qualidade' and user['perfil'] in ENCERRA):
        raise ApiError(403, 'Somente o gestor da área, a Qualidade ou o Administrador podem retornar etapas.')


def next_numero(con, year):
    pre = f"{get_cfg(con).get('prefixo') or 'NC'}-{year}-"
    mx = 0
    for (num,) in con.execute('SELECT numero FROM ncs WHERE numero LIKE ?', (pre + '%',)):
        try:
            mx = max(mx, int(num[len(pre):]))
        except ValueError:
            pass
    return pre + str(mx + 1).zfill(3)


def hist(d, user, acao, alteracoes=None):
    e = {'data': now_iso(), 'usuario': user['nome'], 'acao': acao}
    if alteracoes:
        e['alteracoes'] = alteracoes
    d.setdefault('historico', []).append(e)


# Campos rastreados no histórico (caminho, rótulo)
NC_FIELDS = [
    ('titulo', 'Título'), ('descricao', 'Descrição'), ('dataOcorrencia', 'Data da ocorrência'), ('tipo', 'Tipo'),
    ('origem', 'Origem'), ('classificacao', 'Classificação'), ('setor', 'Setor responsável pela NC'), ('severidade', 'Severidade'),
    ('cliente', 'Cliente / Fornecedor'), ('os', 'Nº Pedido / NF / OC'), ('item', 'Item / equipamento'), ('quantidade', 'Quantidade afetada'),
    ('custo', 'Prejuízo estimado'), ('custoLogHouve', 'Houve custo logístico?'), ('custoLog', 'Custo logístico'), ('detectadoPor', 'Detectado por'), ('responsavel', 'Responsável'), ('prazo', 'Prazo'),
    ('reincidente', 'Reincidente'), ('ncRelacionada', 'NC relacionada'),
    ('contencao.descricao', 'Justificativa do responsável'), ('contencao.disposicao', 'Disposição do produto'),
    ('contencao.responsavel', 'Responsável pela justificativa'), ('contencao.data', 'Data da justificativa'),
    *[(f'causa.porques.{i}', f'{i + 1}º Por quê') for i in range(5)],
    ('causa.causaRaiz', 'Causa raiz'),
    ('eficacia.resultado', 'Eficácia — resultado'), ('eficacia.responsavel', 'Eficácia — verificado por'),
    ('eficacia.data', 'Eficácia — data'), ('eficacia.evidencia', 'Eficácia — evidência'),
    ('qualidadeAcao', 'Ação da Qualidade'), ('encerramento.comentario', 'Comentário de encerramento'),
]
ACAO_FIELDS = [('descricao', 'O quê'), ('tipo', 'Tipo'), ('porque', 'Por quê'), ('onde', 'Onde'), ('responsavel', 'Quem'),
               ('como', 'Como'), ('prazo', 'Quando'), ('custo', 'Quanto custa'), ('status', 'Status'),
               ('conclusao', 'Concluída em'), ('obs', 'Evidência de execução')]
VALUE_LABELS = {'severidade': {'baixa': 'Baixa', 'media': 'Média', 'alta': 'Alta', 'critica': 'Crítica'},
                'reincidente': {'sim': 'Sim', 'nao': 'Não'},
                'custoLogHouve': {'': '—', 'sim': 'Sim', 'nao': 'Não'},
                'eficacia.resultado': {'': 'Pendente', 'eficaz': 'Eficaz', 'ineficaz': 'Não eficaz'}}


def _get(d, path):
    for k in path.split('.'):
        if isinstance(d, list):
            d = d[int(k)] if k.isdigit() and int(k) < len(d) else None
        elif isinstance(d, dict):
            d = d.get(k)
        else:
            return None
    return d


def _fmt(path, v):
    v = '' if v is None else str(v).strip()
    if path in VALUE_LABELS:
        return VALUE_LABELS[path].get(v, v)
    if path.split('.')[-1] in ('custo', 'custoLog') and v:
        try:
            s = f'{float(v):,.2f}'.replace(',', '#').replace('.', ',').replace('#', '.')
            return 'R$ ' + s
        except ValueError:
            return v
    if re.match(r'^\d{4}-\d{2}-\d{2}$', v):
        return f'{v[8:10]}/{v[5:7]}/{v[:4]}'
    return v[:400] + ('…' if len(v) > 400 else '')


def diff_nc(old, new):
    """Lista de alterações {campo, de, para} entre duas versões de uma NC."""
    out = []
    for path, label in NC_FIELDS:
        a, b = _fmt(path, _get(old, path)), _fmt(path, _get(new, path))
        if a != b:
            out.append({'campo': label, 'de': a, 'para': b})
    olds = {a.get('id'): a for a in old.get('acoes') or [] if isinstance(a, dict)}
    news = [a for a in new.get('acoes') or [] if isinstance(a, dict)]
    for i, a in enumerate(news, 1):
        prev = olds.pop(a.get('id'), None)
        if prev is None:
            out.append({'campo': f'Ação {i}', 'de': '', 'para': 'Adicionada: ' + _fmt('', a.get('descricao'))})
            continue
        for k, label in ACAO_FIELDS:
            x, y = _fmt(k, prev.get(k)), _fmt(k, a.get(k))
            if x != y:
                out.append({'campo': f'Ação {i} — {label}', 'de': x, 'para': y})
    for a in olds.values():
        out.append({'campo': 'Ação', 'de': _fmt('', a.get('descricao')), 'para': 'Removida'})
    return out


def write_nc(con, nc_id, numero, status, version, d, insert=False):
    rev = next_rev(con)
    upd = now_iso()
    data = json.dumps(d, ensure_ascii=False)
    if insert:
        con.execute('INSERT INTO ncs(id,numero,status,version,rev,updated_at,data) VALUES(?,?,?,?,?,?,?)',
                    (nc_id, numero, status, version, rev, upd, data))
    else:
        con.execute('UPDATE ncs SET numero=?,status=?,version=?,rev=?,updated_at=?,data=? WHERE id=?',
                    (numero, status, version, rev, upd, data, nc_id))


def decode_data_url(s):
    m = re.match(r'^data:([\w/+.-]+);base64,(.*)$', s or '', re.S)
    if not m:
        raise ApiError(400, 'Arquivo inválido.')
    return m.group(1), base64.b64decode(m.group(2))


# ---------------------------------------------------------------- rotas
ROUTES = []


def route(method, pattern, public=False):
    def deco(fn):
        ROUTES.append((method, re.compile('^' + pattern + '$'), fn, public))
        return fn
    return deco


@route('GET', '/api/status', public=True)
def r_status(h, con, user, body, q):
    n = con.execute('SELECT COUNT(*) FROM users').fetchone()[0]
    return {'setup': n == 0, 'versao': VERSAO}


@route('POST', '/api/setup', public=True)
def r_setup(h, con, user, body, q):
    nome, login, senha = str(body.get('nome', '')).strip(), str(body.get('login', '')).strip(), body.get('senha', '')
    if not nome or not login:
        raise ApiError(422, 'Informe nome e usuário.')
    validate_pw(senha)
    with tx(con):
        if con.execute('SELECT COUNT(*) FROM users').fetchone()[0]:
            raise ApiError(409, 'O sistema já foi configurado.')
        cur = con.execute('INSERT INTO users(nome,login,senha,perfil,criado_em) VALUES(?,?,?,?,?)',
                          (nome, login, hash_pw(senha), 'admin', now_iso()))
        token = new_session(con, cur.lastrowid)
    audit(con, h, {'id': cur.lastrowid, 'nome': nome, 'login': login}, 'Usuários', 'Configuração inicial: administrador criado')
    h.set_cookie(token)
    return {'ok': True}


@route('POST', '/api/login', public=True)
def r_login(h, con, user, body, q):
    ip = h.client_address[0]
    with LOGIN_LOCK:
        fails, until = LOGIN_FAILS.get(ip, (0, 0))
        if until > time.time():
            raise ApiError(429, f'Muitas tentativas. Aguarde {int(until - time.time()) + 1} segundos.')
    login, senha = str(body.get('login', '')).strip(), str(body.get('senha', ''))
    r = con.execute('SELECT * FROM users WHERE login=?', (login,)).fetchone()
    if not r or not check_pw(senha, r['senha']) or not r['ativo']:
        with LOGIN_LOCK:
            fails += 1
            # 5 tentativas erradas seguidas bloqueiam o IP por 60 s
            LOGIN_FAILS[ip] = (0, time.time() + 60) if fails >= 5 else (fails, 0)
        if r and not r['ativo'] and check_pw(senha, r['senha']):
            audit(con, h, r, 'Acesso', 'Tentativa de acesso de usuário desativado')
            raise ApiError(403, 'Usuário desativado. Procure o administrador.')
        audit(con, h, r if r else None, 'Acesso', 'Tentativa de acesso falhou (senha incorreta)' if r else 'Tentativa de acesso com usuário inexistente',
              login=login)
        raise ApiError(401, 'Usuário ou senha incorretos.')
    with LOGIN_LOCK:
        LOGIN_FAILS.pop(ip, None)
    with tx(con):
        token = new_session(con, r['id'])
    audit(con, h, r, 'Acesso', 'Entrou no sistema')
    h.set_cookie(token)
    return {'ok': True}


@route('POST', '/api/logout', public=True)
def r_logout(h, con, user, body, q):
    tok = h.cookie_token()
    if tok:
        s = con.execute('SELECT u.id, u.nome, u.login FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?', (tok,)).fetchone()
        if s:
            with ONLINE_LOCK:
                ONLINE.pop(s['id'], None)   # saiu: deixa de aparecer como online
            audit(con, h, s, 'Acesso', 'Saiu do sistema')
        con.execute('DELETE FROM sessions WHERE token=?', (tok,))
    h.set_cookie('', clear=True)
    return {'ok': True}


@route('GET', '/api/bootstrap')
def r_boot(h, con, user, body, q):
    rev = cur_rev(con)
    rows = visiveis(con, user, con.execute('SELECT * FROM ncs').fetchall())
    anx = anexos_meta(con, [r['id'] for r in rows]) if rows else {}
    return {'me': user_out(user), 'cfg': get_cfg(con), 'pessoas': pessoas(con), 'rev': rev,
            'ncs': [nc_out(r, anx) for r in rows], 'versao': VERSAO, 'online': online_list(), 'notif': notif_resumo(con, user)}


@route('GET', '/api/ncs')
def r_poll(h, con, user, body, q):
    since = int((q.get('since') or ['0'])[0] or 0)
    rev = cur_rev(con)
    cfg = get_cfg(con)
    todas = con.execute('SELECT * FROM ncs').fetchall()
    vis = visiveis(con, user, todas, cfg)
    ids = [r['id'] for r in vis]
    rows = [r for r in vis if r['rev'] > since]
    anx = anexos_meta(con, [r['id'] for r in rows]) if rows else {}
    return {'rev': rev, 'changed': [nc_out(r, anx) for r in rows], 'ids': ids, 'cfg': get_cfg(con), 'pessoas': pessoas(con),
            'online': online_list(), 'notif': notif_resumo(con, user)}


@route('POST', '/api/notificacoes/lidas')
def r_notif_lidas(h, con, user, body, q):
    """Marca notificações do próprio usuário como lidas ({ids:[...]} ou {todas:true})."""
    if body.get('todas'):
        con.execute('UPDATE notificacoes SET lida=1 WHERE user_id=? AND lida=0', (user['id'],))
    else:
        ids = [int(i) for i in (body.get('ids') or []) if str(i).isdigit()][:200]
        if ids:
            con.execute(f"UPDATE notificacoes SET lida=1 WHERE user_id=? AND id IN ({','.join('?' * len(ids))})", [user['id'], *ids])
    return notif_resumo(con, user)


def _num(v):
    try:
        return float(str(v).replace(',', '.')) if str(v or '').strip() else 0.0
    except ValueError:
        return 0.0


def prox_dia_util(iso):
    """Prazo padrão: 1 dia útil após a abertura, pulando sábado e domingo."""
    from datetime import timedelta
    d = date.fromisoformat(iso[:10]) + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d.isoformat()


@route('POST', '/api/ncs')
def r_create(h, con, user, body, q):
    d = clean(body.get('nc'))
    rascunho = bool(body.get('rascunho'))
    if rascunho:
        check_rascunho(con, d)
    else:
        check_required(d)
        check_severidade(d)
        check_custo_log(d, nova=True)
        check_responsavel(con, d)
    d['criadoPor'], d['criadoPorId'] = user['nome'], user['id']
    d['dataRegistro'], d['createdAt'] = today(), now_iso()
    if not d.get('prazo'):
        d['prazo'] = prox_dia_util(d['dataRegistro'])
    if not _num(d.get('custo')):   # sem prejuízo informado: usa o custo médio do setor (Configurações)
        cm = (get_cfg(con).get('setorCusto') or {}).get(d.get('setor') or '')
        if cm:
            d['custo'] = cm
    d['encerramento'] = {'data': '', 'por': '', 'comentario': str(((body.get('nc') or {}).get('encerramento') or {}).get('comentario', ''))}
    d['historico'] = []
    if rascunho:   # fica com quem abriu até ele clicar em "Enviar para análise"
        hist(d, user, 'Rascunho salvo')
    else:          # enviada direto: vai para "Em análise", com o responsável pelo tratamento
        hist(d, user, 'Não conformidade registrada')
        hist(d, user, f"Status: {STATUS_LABEL['aberta']} → {STATUS_LABEL['analise']}")
    nc_id = secrets.token_hex(8)
    with tx(con):
        numero = next_numero(con, d['dataOcorrencia'][:4])
        write_nc(con, nc_id, numero, 'aberta' if rascunho else 'analise', 1, d, insert=True)
        if not rascunho:   # avisa o responsável pelo tratamento (pop-up + sino)
            notificar(con, user, [d.get('responsavel')], f'Nova NC para você tratar: {numero}', d.get('titulo') or '', nc_id, numero)
        audit(con, h, user, 'NC', f'{"Salvou rascunho" if rascunho else "Registrou e enviou para análise"} {numero}',
              f"{d.get('titulo') or ''} · responsável: {d.get('responsavel') or '—'} · setor: {d.get('setor') or '—'}", ref=numero)
    return {'nc': nc_out(load_nc(con, nc_id), anexos_meta(con, [nc_id]))}


@route('PUT', '/api/ncs/(?P<id>[\\w-]+)')
def r_update(h, con, user, body, q, id):
    nc_in = body.get('nc') or {}
    with tx(con):
        cfg = get_cfg(con)
        row = load_visivel(con, user, id, cfg)
        old = json.loads(row['data'])
        frm = row['status']
        if not can_edit(user, old, frm, cfg):
            raise ApiError(403, 'Você não tem permissão para alterar esta NC. Ela pode ser editada pelo responsável, por quem a registrou ou pela Qualidade.')
        if not body.get('force') and body.get('version') != row['version']:
            last = (old.get('historico') or [{}])[-1]
            raise ApiError(409, 'Esta NC foi alterada por outro usuário enquanto você editava.',
                           nc=nc_out(row, anexos_meta(con, [id])), por=last.get('usuario'), em=last.get('data'))
        d = clean(nc_in)
        for k in ('criadoPor', 'criadoPorId', 'createdAt', 'dataRegistro'):
            if k in old:
                d[k] = old[k]
        d['historico'] = list(old.get('historico') or [])
        enc = dict(old.get('encerramento') or {'data': '', 'por': ''})
        enc['comentario'] = str((nc_in.get('encerramento') or {}).get('comentario', enc.get('comentario', '')))[:5000]
        d['encerramento'] = enc
        to = nc_in.get('status') or frm
        if to == 'aberta':   # continua rascunho: validação mínima
            check_rascunho(con, d, old)
        else:
            check_required(d)
            check_severidade(d, old)
            check_custo_log(d, nova=frm == 'aberta')
            check_responsavel(con, d, old if frm != 'aberta' else None)
        check_transition(user, d, frm, to, cfg)
        changed = content_key(d) != content_key(old)
        alt = []
        if changed:
            alt = diff_nc(old, d)
            hist(d, user, 'Registro atualizado' if alt else 'Registro atualizado (sem mudança de conteúdo)', alteracoes=alt)
        nota = str(body.get('nota') or '').strip()
        if nota:
            hist(d, user, nota[:2000])
        if to != frm:
            hist(d, user, f'Status: {STATUS_LABEL[frm]} → {STATUS_LABEL[to]}')
            if to == 'encerrada':
                d['encerramento'].update(data=today(), por=user['nome'])
            elif frm == 'encerrada':
                d['encerramento'].update(data='', por='')
        if not changed and not nota and to == frm:
            return {'nc': nc_out(row, anexos_meta(con, [id]))}
        write_nc(con, id, row['numero'], to, row['version'] + 1, d)
        n = row['numero']
        if to != frm:
            notificar_etapa(con, user, d, id, n, frm, to, cfg)
        if to not in ('aberta', 'encerrada', 'cancelada') and norm(d.get('responsavel')) != norm(old.get('responsavel')) \
                and not (frm == 'aberta' and to == 'analise'):
            notificar(con, user, [d.get('responsavel')], f'{n} foi atribuída a você', d.get('titulo') or '', id, n)
        if to != frm:
            audit(con, h, user, 'NC', f'{n}: {STATUS_LABEL[frm]} → {STATUS_LABEL[to]}', '; '.join(x for x in (nota, resumo_alteracoes(alt)) if x), ref=n)
        else:
            audit(con, h, user, 'NC', f'Alterou {n}', '; '.join(x for x in (resumo_alteracoes(alt), nota) if x), ref=n)
    return {'nc': nc_out(load_nc(con, id), anexos_meta(con, [id]))}


@route('DELETE', '/api/ncs/(?P<id>[\\w-]+)')
def r_delete(h, con, user, body, q, id):
    if user['perfil'] != 'admin':
        raise ApiError(403, 'Somente o administrador pode excluir NCs.')
    with tx(con):
        row = load_nc(con, id)
        con.execute('DELETE FROM ncs WHERE id=?', (id,))
        next_rev(con)
        audit(con, h, user, 'NC', f"Excluiu definitivamente {row['numero']}", json.loads(row['data']).get('titulo') or '', ref=row['numero'])
    return {'ok': True}


@route('POST', '/api/ncs/(?P<id>[\\w-]+)/anexos')
def r_anexo_add(h, con, user, body, q, id):
    tipo, raw = decode_data_url(body.get('data'))
    tipo = body.get('tipo') or tipo
    if tipo not in FILE_TYPES:
        raise ApiError(415, 'Formato não suportado. Use imagens ou PDF.')
    if len(raw) > MAX_FILE:
        raise ApiError(413, f'Arquivo maior que {MAX_FILE // 1024 // 1024} MB.')
    nome = str(body.get('nome') or 'arquivo')[:200]
    with tx(con):
        row = load_visivel(con, user, id)
        d = json.loads(row['data'])
        if not can_edit(user, d, row['status'], get_cfg(con)):
            raise ApiError(403, 'Você não tem permissão para anexar arquivos nesta NC.')
        aid = secrets.token_hex(8)
        con.execute('INSERT INTO anexos(id,nc_id,nome,tipo,tamanho,conteudo,criado_em,por) VALUES(?,?,?,?,?,?,?,?)',
                    (aid, id, nome, tipo, len(raw), raw, now_iso(), user['nome']))
        hist(d, user, f'Anexo adicionado: {nome}')
        write_nc(con, id, row['numero'], row['status'], row['version'], d)
        audit(con, h, user, 'NC', f"Anexou arquivo em {row['numero']}", nome, ref=row['numero'])
    return {'anexo': next(a for a in anexos_meta(con, [id])[id] if a['id'] == aid)}


@route('GET', '/api/anexos/(?P<id>[\\w-]+)')
def r_anexo_get(h, con, user, body, q, id):
    r = con.execute('SELECT nome,tipo,conteudo,nc_id FROM anexos WHERE id=?', (id,)).fetchone()
    if not r:
        raise ApiError(404, 'Anexo não encontrado.')
    load_visivel(con, user, r['nc_id'])
    h.send_bytes(bytes(r['conteudo']), r['tipo'], {
        'Content-Disposition': f"inline; filename*=UTF-8''{quote(r['nome'])}",
        'Cache-Control': 'private, max-age=604800'})
    return None


@route('DELETE', '/api/anexos/(?P<id>[\\w-]+)')
def r_anexo_del(h, con, user, body, q, id):
    with tx(con):
        a = con.execute('SELECT nc_id,nome FROM anexos WHERE id=?', (id,)).fetchone()
        if not a:
            raise ApiError(404, 'Anexo não encontrado.')
        row = load_visivel(con, user, a['nc_id'])
        d = json.loads(row['data'])
        if not can_edit(user, d, row['status'], get_cfg(con)):
            raise ApiError(403, 'Você não tem permissão para remover anexos desta NC.')
        con.execute('DELETE FROM anexos WHERE id=?', (id,))
        hist(d, user, f'Anexo removido: {a["nome"]}')
        write_nc(con, row['id'], row['numero'], row['status'], row['version'], d)
        audit(con, h, user, 'NC', f"Removeu anexo de {row['numero']}", a['nome'], ref=row['numero'])
    return {'ok': True}


@route('PUT', '/api/config')
def r_cfg(h, con, user, body, q):
    if user['perfil'] != 'admin':
        raise ApiError(403, 'Somente o administrador altera as configurações.')
    cfg = get_cfg(con)
    antes = json.loads(json.dumps(cfg))
    for k in ('setores', 'tipos', 'origens', 'disposicoes', 'responsaveis'):
        if isinstance(body.get(k), list):
            cfg[k] = [str(x).strip()[:120] for x in body[k] if str(x).strip()]
    if body.get('prefixo'):
        cfg['prefixo'] = re.sub(r'[^A-Za-z0-9]', '', str(body['prefixo']))[:6].upper() or 'NC'
    if isinstance(body.get('setorResp'), dict):
        ativos = set(pessoas(con))
        for s, nome in body['setorResp'].items():
            if nome and nome not in ativos:
                raise ApiError(422, f'"{nome}" não é um usuário ativo.')
        cfg['setorResp'] = {str(s): str(n) for s, n in body['setorResp'].items() if n}
    if isinstance(body.get('setorGestor'), dict):
        ativos = set(pessoas(con))
        for s, nome in body['setorGestor'].items():
            if nome and nome not in ativos:
                raise ApiError(422, f'"{nome}" não é um usuário ativo.')
        cfg['setorGestor'] = {str(s): str(n) for s, n in body['setorGestor'].items() if n}
    if isinstance(body.get('setorUsuarios'), dict):
        ativos = set(pessoas(con))
        novo = {}
        for s, nomes in body['setorUsuarios'].items():
            if not isinstance(nomes, list):
                continue
            for nome in nomes:
                if nome not in ativos:
                    raise ApiError(422, f'"{nome}" não é um usuário ativo.')
            if nomes:
                novo[str(s)] = list(dict.fromkeys(str(n) for n in nomes))
        cfg['setorUsuarios'] = novo
    if isinstance(body.get('setorCusto'), dict):
        custos = {}
        for s, v in body['setorCusto'].items():
            try:
                x = round(float(str(v).replace(',', '.')), 2)
            except (TypeError, ValueError):
                raise ApiError(422, f'Custo médio inválido para o setor "{s}".')
            if x < 0 or x > 1e9:
                raise ApiError(422, f'Custo médio inválido para o setor "{s}".')
            if x > 0:
                custos[str(s)] = f'{x:.2f}'
        cfg['setorCusto'] = custos
    for k in ('setorResp', 'setorGestor', 'setorUsuarios', 'setorCusto'):
        cfg[k] = {s: n for s, n in (cfg.get(k) or {}).items() if s in cfg['setores']}
    con.execute("INSERT INTO kv(k,v) VALUES('cfg',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (json.dumps(cfg, ensure_ascii=False),))
    nomes = {'setores': 'Setores', 'origens': 'Origens', 'disposicoes': 'Disposições', 'responsaveis': 'Responsáveis externos',
             'prefixo': 'Prefixo', 'setorGestor': 'Gestor da área', 'setorUsuarios': 'Equipe do setor', 'setorCusto': 'Custo médio ADM/Operação'}
    mud = []
    for k, rot in nomes.items():
        a, b = antes.get(k), cfg.get(k)
        if a == b:
            continue
        if isinstance(a, list) and isinstance(b, list):
            add, rem = [x for x in b if x not in a], [x for x in a if x not in b]
            mud.append(f"{rot}: " + ', '.join(([f'+{x}' for x in add] + [f'-{x}' for x in rem]) or ['reordenado']))
        elif isinstance(a, dict) and isinstance(b, dict):
            ks = [s for s in set(a) | set(b) if a.get(s) != b.get(s)]
            mud.append(f"{rot}: " + ', '.join(f"{s}: {a.get(s) or '—'} → {b.get(s) or '—'}" for s in sorted(ks)))
        else:
            mud.append(f'{rot}: {a} → {b}')
    if mud:
        audit(con, h, user, 'Configurações', 'Alterou configurações', '; '.join(mud))
    return {'cfg': cfg}


def require_admin(user):
    if user['perfil'] != 'admin':
        raise ApiError(403, 'Somente o administrador gerencia usuários.')


@route('GET', '/api/users')
def r_users(h, con, user, body, q):
    if user['perfil'] not in VE_TUDO:   # o gestor consulta a lista (somente leitura)
        require_admin(user)
    return {'users': [user_out(r, True) for r in con.execute('SELECT * FROM users ORDER BY ativo DESC, nome COLLATE NOCASE')]}


@route('POST', '/api/users')
def r_user_new(h, con, user, body, q):
    require_admin(user)
    nome, login = str(body.get('nome', '')).strip(), str(body.get('login', '')).strip()
    perfil = body.get('perfil')
    if not nome or not login:
        raise ApiError(422, 'Informe nome e usuário de acesso.')
    if not re.match(r'^[\w.@-]{3,40}$', login):
        raise ApiError(422, 'Usuário de acesso: 3 a 40 caracteres, sem espaços.')
    if perfil not in PERFIS:
        raise ApiError(422, 'Perfil inválido.')
    senha = body.get('senha') or temp_password()
    validate_pw(senha)
    try:
        with tx(con):
            con.execute('INSERT INTO users(nome,login,email,senha,perfil,trocar_senha,criado_em) VALUES(?,?,?,?,?,1,?)',
                        (nome, login, str(body.get('email', '')).strip(), hash_pw(senha), perfil, now_iso()))
            next_rev(con)
            audit(con, h, user, 'Usuários', f'Criou o usuário {nome}', f'login: {login} · perfil: {perfil}')
    except sqlite3.IntegrityError:
        raise ApiError(409, f'Já existe um usuário com o login "{login}".')
    return {'ok': True, 'senha': senha}


@route('PUT', '/api/users/(?P<uid>\\d+)')
def r_user_upd(h, con, user, body, q, uid):
    require_admin(user)
    uid = int(uid)
    out = {'ok': True}
    with tx(con):
        r = con.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()
        if not r:
            raise ApiError(404, 'Usuário não encontrado.')
        nome = str(body.get('nome', r['nome'])).strip() or r['nome']
        perfil = body.get('perfil', r['perfil'])
        ativo = 1 if body.get('ativo', bool(r['ativo'])) else 0
        if perfil not in PERFIS:
            raise ApiError(422, 'Perfil inválido.')
        if r['perfil'] == 'admin' and r['ativo'] and (perfil != 'admin' or not ativo) and active_admins(con, uid) == 0:
            raise ApiError(422, 'É preciso manter pelo menos um administrador ativo.')
        con.execute('UPDATE users SET nome=?,email=?,perfil=?,ativo=? WHERE id=?',
                    (nome, str(body.get('email', r['email'] or '')).strip(), perfil, ativo, uid))
        if body.get('resetSenha'):
            senha = temp_password()
            con.execute('UPDATE users SET senha=?,trocar_senha=1 WHERE id=?', (hash_pw(senha), uid))
            con.execute('DELETE FROM sessions WHERE user_id=?', (uid,))
            out['senha'] = senha
        if not ativo:
            con.execute('DELETE FROM sessions WHERE user_id=?', (uid,))
        next_rev(con)
        mud = []
        if nome != r['nome']: mud.append(f"nome: {r['nome']} → {nome}")
        if perfil != r['perfil']: mud.append(f"perfil: {r['perfil']} → {perfil}")
        if ativo != r['ativo']: mud.append('reativado' if ativo else 'desativado (acesso bloqueado)')
        if body.get('resetSenha'): mud.append('nova senha provisória gerada')
        email = str(body.get('email', r['email'] or '')).strip()
        if email != (r['email'] or ''): mud.append(f"e-mail: {r['email'] or '—'} → {email or '—'}")
        if mud:
            audit(con, h, user, 'Usuários', f"Alterou o usuário {nome}", '; '.join(mud))
    return out


@route('DELETE', '/api/users/(?P<uid>\\d+)')
def r_user_del(h, con, user, body, q, uid):
    """Exclui o usuário (ex.: desligamento). As NCs mantêm o nome dele no histórico."""
    require_admin(user)
    uid = int(uid)
    if uid == user['id']:
        raise ApiError(422, 'Você não pode excluir o seu próprio usuário.')
    with tx(con):
        r = con.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()
        if not r:
            raise ApiError(404, 'Usuário não encontrado.')
        if r['perfil'] == 'admin' and r['ativo'] and active_admins(con, uid) == 0:
            raise ApiError(422, 'É preciso manter pelo menos um administrador ativo.')
        abertas = sum(1 for row in con.execute("SELECT data FROM ncs WHERE status NOT IN ('encerrada','cancelada')")
                      if norm(json.loads(row['data']).get('responsavel')) == norm(r['nome']))
        con.execute('DELETE FROM sessions WHERE user_id=?', (uid,))
        con.execute('DELETE FROM users WHERE id=?', (uid,))
        # tira o usuário da hierarquia dos setores (gestor / equipe)
        cfg = get_cfg(con); nm = norm(r['nome'])
        for k in ('setorGestor', 'setorResp'):
            cfg[k] = {s: n for s, n in (cfg.get(k) or {}).items() if norm(n) != nm}
        cfg['setorUsuarios'] = {s: [n for n in ns if norm(n) != nm] for s, ns in (cfg.get('setorUsuarios') or {}).items()}
        con.execute("INSERT INTO kv(k,v) VALUES('cfg',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (json.dumps(cfg, ensure_ascii=False),))
        next_rev(con)
        audit(con, h, user, 'Usuários', f"Excluiu o usuário {r['nome']}", f"login: {r['login']} · perfil: {r['perfil']} · NCs em aberto com ele: {abertas}")
    return {'ok': True, 'ncsAbertas': abertas}


@route('POST', '/api/me/senha')
def r_me_pw(h, con, user, body, q):
    if not check_pw(str(body.get('atual', '')), user['senha']):
        raise ApiError(422, 'Senha atual incorreta.')
    validate_pw(body.get('nova'))
    if body.get('nova') == body.get('atual'):
        raise ApiError(422, 'A nova senha deve ser diferente da atual.')
    con.execute('UPDATE users SET senha=?,trocar_senha=0 WHERE id=?', (hash_pw(body['nova']), user['id']))
    audit(con, h, user, 'Acesso', 'Trocou a própria senha')
    return {'ok': True}


@route('GET', '/api/backup')
def r_backup(h, con, user, body, q):
    require_admin(user)
    anx = {}
    for a in con.execute('SELECT * FROM anexos ORDER BY criado_em'):
        anx.setdefault(a['nc_id'], []).append({'id': a['id'], 'nome': a['nome'], 'tipo': a['tipo'], 'em': a['criado_em'], 'por': a['por'],
                                               'data': f"data:{a['tipo']};base64,{base64.b64encode(a['conteudo']).decode()}"})
    ncs = []
    for r in con.execute('SELECT * FROM ncs'):
        d = nc_out(r, {})
        d['anexos'] = anx.get(r['id'], [])
        ncs.append(d)
    payload = json.dumps({'app': 'melting-nc', 'versao': 2, 'exportadoEm': now_iso(), 'cfg': get_cfg(con), 'ncs': ncs}, ensure_ascii=False)
    audit(con, h, user, 'Configurações', 'Baixou backup completo', f'{len(ncs)} NC(s)')
    h.send_bytes(payload.encode(), 'application/json', {
        'Content-Disposition': f'attachment; filename="backup-melting-nc_{today()}.json"'})
    return None


@route('POST', '/api/import')
def r_import(h, con, user, body, q):
    require_admin(user)
    if body.get('app') != 'melting-nc' or not isinstance(body.get('ncs'), list):
        raise ApiError(422, 'Arquivo não é um backup deste sistema.')
    n_ok = 0
    with tx(con):
        if isinstance(body.get('cfg'), dict):
            cfg = get_cfg(con)
            for k in ('setores', 'tipos', 'origens', 'disposicoes', 'responsaveis'):
                if isinstance(body['cfg'].get(k), list):
                    cfg[k] = list(dict.fromkeys(cfg[k] + [str(x) for x in body['cfg'][k]]))
            con.execute("INSERT INTO kv(k,v) VALUES('cfg',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (json.dumps(cfg, ensure_ascii=False),))
        for nc in body['ncs']:
            if not isinstance(nc, dict) or not nc.get('id'):
                continue
            nc_id = re.sub(r'[^\w-]', '', str(nc['id']))[:40]
            d = clean(nc)
            for k in ('historico', 'criadoPor', 'criadoPorId', 'createdAt', 'dataRegistro', 'encerramento'):
                if k in nc:
                    d[k] = nc[k]
            d.setdefault('historico', []).append({'data': now_iso(), 'usuario': user['nome'], 'acao': 'Registro importado de backup'})
            status = nc.get('status') if nc.get('status') in STATUS_LABEL else 'aberta'
            numero = str(nc.get('numero') or '')
            clash = con.execute('SELECT id FROM ncs WHERE numero=?', (numero,)).fetchone()
            if not numero or (clash and clash['id'] != nc_id):
                numero = next_numero(con, str(d.get('dataOcorrencia') or today())[:4])
            exists = con.execute('SELECT version FROM ncs WHERE id=?', (nc_id,)).fetchone()
            write_nc(con, nc_id, numero, status, (exists['version'] + 1) if exists else 1, d, insert=not exists)
            for a in nc.get('anexos') or []:
                if not isinstance(a, dict) or not a.get('data'):
                    continue
                try:
                    tipo, raw = decode_data_url(a['data'])
                except Exception:
                    continue
                if tipo not in FILE_TYPES:
                    continue
                aid = re.sub(r'[^\w-]', '', str(a.get('id') or secrets.token_hex(8)))[:40]
                con.execute('INSERT OR REPLACE INTO anexos(id,nc_id,nome,tipo,tamanho,conteudo,criado_em,por) VALUES(?,?,?,?,?,?,?,?)',
                            (aid, nc_id, str(a.get('nome') or 'arquivo')[:200], tipo, len(raw), raw, a.get('em') or now_iso(), a.get('por') or user['nome']))
            n_ok += 1
        audit(con, h, user, 'Configurações', 'Importou backup', f'{n_ok} NC(s) importada(s)')
    return {'ok': True, 'importadas': n_ok}


@route('GET', '/api/auditoria')
def r_auditoria(h, con, user, body, q):
    """Trilha de auditoria: acessos e alterações. Administrador e Gestor consultam."""
    if user['perfil'] not in VE_TUDO:
        raise ApiError(403, 'Somente o administrador ou o gestor consultam os logs de acesso.')
    g = lambda k: (q.get(k) or [''])[0].strip()
    where, args = [], []
    if g('user'):
        where.append('user_id=?'); args.append(int(g('user')) if g('user').isdigit() else -1)
    if g('tipo') in AUD_TIPOS:
        where.append('tipo=?'); args.append(g('tipo'))
    if re.match(r'^\d{4}-\d{2}-\d{2}$', g('de')):
        where.append('substr(data,1,10)>=?'); args.append(g('de'))
    if re.match(r'^\d{4}-\d{2}-\d{2}$', g('ate')):
        where.append('substr(data,1,10)<=?'); args.append(g('ate'))
    if g('q'):
        where.append("(acao LIKE ? OR detalhe LIKE ? OR usuario LIKE ? OR login LIKE ? OR ref LIKE ?)"); args += [f"%{g('q')}%"] * 5
    lim = min(max(int(g('limit') or 500) if g('limit').isdigit() else 500, 1), 5000)
    sql = 'SELECT * FROM auditoria' + (' WHERE ' + ' AND '.join(where) if where else '') + ' ORDER BY id DESC LIMIT ?'
    rows = con.execute(sql, args + [lim]).fetchall()
    total = con.execute('SELECT COUNT(*) FROM auditoria' + (' WHERE ' + ' AND '.join(where) if where else ''), args).fetchone()[0]
    return {'total': total, 'logs': [{k: r[k] for k in ('id', 'data', 'user_id', 'usuario', 'login', 'tipo', 'acao', 'detalhe', 'ref', 'ip')} for r in rows]}


# ---------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = 'MeltingNC/' + VERSAO
    protocol_version = 'HTTP/1.1'
    timeout = 120

    def log_message(self, fmt, *args):
        pass

    def cookie_token(self):
        c = SimpleCookie(self.headers.get('Cookie') or '')
        return c['nc_sid'].value if 'nc_sid' in c else None

    def set_cookie(self, token, clear=False):
        age = 0 if clear else SESSION_DAYS * 86400
        self._cookie = f'nc_sid={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={age}'

    def send_bytes(self, data, ctype, extra=None, status=200):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        if getattr(self, '_cookie', None):
            self.send_header('Set-Cookie', self._cookie)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(data)
        self._sent = True

    def send_json(self, obj, status=200):
        self.send_bytes(json.dumps(obj, ensure_ascii=False).encode(), 'application/json; charset=utf-8',
                        {'Cache-Control': 'no-store'}, status)

    def auth(self, con):
        tok = self.cookie_token()
        if not tok:
            return None
        r = con.execute('SELECT u.*, s.expira FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expira>? AND u.ativo=1',
                        (tok, time.time())).fetchone()
        if r and r['expira'] - time.time() < SESSION_DAYS * 86400 / 2:
            con.execute('UPDATE sessions SET expira=? WHERE token=?', (time.time() + SESSION_DAYS * 86400, tok))
        if r:
            marca_online(r)
        return r

    def handle_api(self, method, path, query):
        con = db()
        try:
            for m, rx, fn, public in ROUTES:
                if m != method:
                    continue
                mt = rx.match(path)
                if not mt:
                    continue
                if method != 'GET' and self.headers.get('X-NC') != '1':
                    raise ApiError(403, 'Requisição recusada.')
                user = None if public else self.auth(con)
                if not public and not user:
                    raise ApiError(401, 'Faça login para continuar.')
                body = {}
                if method in ('POST', 'PUT'):
                    n = int(self.headers.get('Content-Length') or 0)
                    if n > MAX_BODY:
                        raise ApiError(413, 'Requisição muito grande.')
                    raw = self.rfile.read(n) if n else b''
                    try:
                        body = json.loads(raw or b'{}')
                    except json.JSONDecodeError:
                        raise ApiError(400, 'JSON inválido.')
                res = fn(self, con, user, body, query, **mt.groupdict())
                if res is not None:
                    self.send_json(res)
                return
            raise ApiError(404, 'Rota não encontrada.')
        except ApiError as e:
            self.send_json({'erro': e.msg, **e.extra}, e.status)
        except Exception:
            traceback.print_exc()
            self.send_json({'erro': 'Erro interno no servidor.'}, 500)
        finally:
            con.close()

    def serve_static(self, path):
        rel = 'index.html' if path in ('', '/') else path.lstrip('/')
        f = (PUBLIC / rel).resolve()
        if PUBLIC not in f.parents or not f.is_file():
            return self.send_bytes(b'Nao encontrado', 'text/plain; charset=utf-8', status=404)
        ctype = CONTENT_TYPES.get(f.suffix.lower(), 'application/octet-stream')
        self.send_bytes(f.read_bytes(), ctype, {'Cache-Control': 'no-cache'})

    def dispatch(self, method):
        self._cookie = None
        u = urlparse(self.path)
        if u.path.startswith('/api/'):
            self.handle_api(method, u.path, parse_qs(u.query))
        elif method in ('GET', 'HEAD'):
            self.serve_static(u.path)
        else:
            self.send_bytes(b'', 'text/plain', status=405)

    def do_GET(self):
        self.dispatch('GET')

    def do_HEAD(self):
        self.dispatch('GET')

    def do_POST(self):
        self.dispatch('POST')

    def do_PUT(self):
        self.dispatch('PUT')

    def do_DELETE(self):
        self.dispatch('DELETE')


class Server(ThreadingHTTPServer):
    daemon_threads = True
    # No Windows, SO_REUSEADDR deixaria dois servidores dividirem a mesma porta; usamos uso exclusivo.
    allow_reuse_address = os.name != 'nt'

    def server_bind(self):
        if os.name == 'nt' and hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def handle_error(self, request, client_address):
        # navegadores fecham conexões ociosas a todo momento: não é erro
        if isinstance(sys.exc_info()[1], (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, TimeoutError)):
            return
        super().handle_error(request, client_address)


# ---------------------------------------------------------------- backup automático
def backup_loop(keep=30):
    folder = DB_PATH.parent / 'backups'
    while True:
        try:
            folder.mkdir(exist_ok=True)
            dest = folder / f'melting-nc_{today()}.db'
            if not dest.exists():
                src = db()
                out = sqlite3.connect(dest)
                src.backup(out)
                out.close()
                src.close()
                for old in sorted(folder.glob('melting-nc_*.db'))[:-keep]:
                    old.unlink()
        except Exception:
            traceback.print_exc()
        time.sleep(3600)


def lan_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if not ip.startswith('127.'):
                ips.add(ip)
    except Exception:
        pass
    # 169.254.x.x = placa sem rede configurada; não serve para acesso
    return sorted(ip for ip in ips if not ip.startswith('169.254.'))


def main():
    global DB_PATH
    ap = argparse.ArgumentParser(description='Melting · Gestão de Não Conformidades')
    ap.add_argument('--port', type=int, default=8080)
    ap.add_argument('--host', default='0.0.0.0')
    ap.add_argument('--data', default=str(BASE / 'data'), help='pasta do banco de dados')
    a = ap.parse_args()
    DB_PATH = Path(a.data).resolve() / 'melting-nc.db'
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    oculto = sys.stdout is None or sys.stderr is None  # rodando com pythonw (sem janela)
    if oculto:
        log = DB_PATH.parent / 'servidor.log'
        if log.exists() and log.stat().st_size > 2 * 1024 * 1024:
            log.unlink()
        sys.stdout = sys.stderr = open(log, 'a', encoding='utf-8', buffering=1)
        print(f'\n--- {datetime.now():%d/%m/%Y %H:%M:%S} iniciando (modo oculto) ---')
    init_db()
    threading.Thread(target=backup_loop, daemon=True).start()
    try:
        srv = Server((a.host, a.port), Handler)
    except OSError as e:
        print(f'\n  ERRO: não foi possível usar a porta {a.port} ({e}).\n  O servidor provavelmente já está rodando (inclusive sem janela).\n'
              f'  Para encerrá-lo use parar-servidor.bat, ou rode em outra porta: python server.py --port 8081\n')
        sys.exit(1)
    line = '=' * 64
    print(f'\n{line}\n  MELTING · Gestão de Não Conformidades  (v{VERSAO})\n{line}')
    print(f'  Neste computador:  http://localhost:{a.port}')
    for ip in lan_ips():
        print(f'  Na rede:           http://{ip}:{a.port}')
    print(f'\n  Banco de dados:    {DB_PATH}')
    print(f'  Backups diários:   {DB_PATH.parent / "backups"}')
    if oculto:
        print(f'\n  Rodando sem janela. Para parar: parar-servidor.bat\n{line}\n')
    else:
        print(f'\n  Mantenha esta janela aberta. Para parar: Ctrl+C\n{line}\n')
    with open(DB_PATH.parent / 'ENDERECOS.txt', 'w', encoding='utf-8') as f:
        f.write('Endereços do sistema Melting · Não Conformidades\n\n')
        f.write(f'Neste computador:  http://localhost:{a.port}\n')
        for ip in lan_ips():
            f.write(f'Na rede:           http://{ip}:{a.port}\n')
        f.write(f'\nAtualizado em {datetime.now():%d/%m/%Y %H:%M}\n')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\n  Servidor encerrado.')


if __name__ == '__main__':
    main()
