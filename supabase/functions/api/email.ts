/**
 * Melting NC — envio da senha provisória por e-mail (Resend).
 * Segredos da função (Supabase → Edge Functions → Secrets):
 *   RESEND_API_KEY  chave do Resend (obrigatória para enviar)
 *   NC_EMAIL_FROM   remetente (padrão: Melting NC <nao-responda@nc-melting.com.br>)
 *   NC_SITE_URL     endereço do sistema (padrão: https://nc-melting.com.br)
 */
// deno-lint-ignore no-explicit-any
type Any = any;
const str = (v: Any) => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const RESEND_URL = Deno.env.get('NC_RESEND_URL') || 'https://api.resend.com/emails';
const SITE_URL = (Deno.env.get('NC_SITE_URL') || 'https://nc-melting.com.br').replace(/\/+$/, '');
const EMAIL_FROM = Deno.env.get('NC_EMAIL_FROM') || 'Melting NC <nao-responda@nc-melting.com.br>';
const escHtml = (s: Any) => str(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Any)[c]);
const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function htmlSenha(nome: string, login: string, senha: string, novo: boolean) {
  const titulo = novo ? 'Seu acesso ao sistema de Não Conformidades' : 'Sua nova senha provisória';
  const intro = novo
    ? 'Você foi cadastrado(a) no sistema de Gestão de Não Conformidades da Melting. Use os dados abaixo para o primeiro acesso:'
    : 'O administrador gerou uma nova senha provisória para o seu acesso ao sistema de Gestão de Não Conformidades da Melting:';
  const linha = (rot: string, val: string, mono = false) => `<tr><td style="padding:10px 16px;color:#5f7593;font-size:13px;border-bottom:1px solid #e6edf6;width:130px">${rot}</td>
    <td style="padding:10px 16px;font-size:15px;font-weight:700;color:#0c1524;border-bottom:1px solid #e6edf6;${mono ? 'font-family:Consolas,Menlo,monospace;letter-spacing:.5px' : ''}">${val}</td></tr>`;
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:0;background:#eef3f9;font-family:Segoe UI,Roboto,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3f9;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 8px 30px rgba(6,10,18,.08)">
  <tr><td style="background:#060a12;background-image:linear-gradient(135deg,#0c1d36,#060a12);padding:22px 26px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td><img src="${SITE_URL}/assets/icone-180.png" width="44" height="44" alt="NC" style="display:block;border-radius:10px"></td>
      <td style="padding-left:14px;color:#e8eff9;font-size:15px;line-height:1.3"><b style="font-size:17px">Melting</b><br><span style="color:#93a7c0">Gestão de Não Conformidades</span></td>
    </tr></table></td></tr>
  <tr><td style="padding:28px 26px 8px">
    <h1 style="margin:0 0 10px;font-size:20px;color:#0c1524">${titulo}</h1>
    <p style="margin:0 0 6px;font-size:15px;color:#33475f;line-height:1.55">Olá, <b>${escHtml(nome)}</b>!</p>
    <p style="margin:0 0 18px;font-size:15px;color:#33475f;line-height:1.55">${intro}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6edf6;border-radius:10px;border-collapse:separate;overflow:hidden">
      ${linha('Endereço', `<a href="${SITE_URL}" style="color:#1263A4;text-decoration:none">${SITE_URL.replace(/^https?:\/\//, '')}</a>`)}
      ${linha('Usuário', escHtml(login))}
      ${linha('Senha provisória', escHtml(senha), true)}
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 8px"><tr><td style="border-radius:10px;background:#1263A4">
      <a href="${SITE_URL}" style="display:inline-block;padding:12px 26px;color:#ffffff;font-weight:700;font-size:15px;text-decoration:none">Acessar o sistema</a></td></tr></table>
    <p style="margin:14px 0 0;font-size:13px;color:#5f7593;line-height:1.5">No primeiro acesso o sistema vai pedir que você crie uma senha pessoal. Não compartilhe esta senha com ninguém.</p>
  </td></tr>
  <tr><td style="padding:22px 26px;color:#93a7c0;font-size:12px;line-height:1.5;border-top:1px solid #eef3f9;margin-top:20px">
    Mensagem automática — não responda este e-mail. Em caso de dúvida, procure o administrador do sistema.<br>Melting · Soluções em Manutenção Industrial</td></tr>
</table></td></tr></table></body></html>`;
}

/** Envia a senha provisória por e-mail. Nunca derruba a operação: devolve o resultado para a tela avisar o admin. */
export async function enviarSenha(nome: string, login: string, email: string, senha: string, novo: boolean) {
  const para = str(email).trim();
  if (!para) return { enviado: false, motivo: 'Usuário sem e-mail cadastrado.' };
  if (!emailValido(para)) return { enviado: false, para, motivo: 'E-mail cadastrado é inválido.' };
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return { enviado: false, para, motivo: 'Envio de e-mail ainda não configurado.' };
  const texto = `Olá, ${nome}!\n\n${novo ? 'Seu acesso ao sistema de Não Conformidades da Melting:' : 'Sua nova senha provisória do sistema de Não Conformidades da Melting:'}\n\n` +
    `Endereço: ${SITE_URL}\nUsuário: ${login}\nSenha provisória: ${senha}\n\nNo primeiro acesso o sistema vai pedir que você crie uma senha pessoal.\n\nMensagem automática — não responda este e-mail.`;
  try {
    const r = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: EMAIL_FROM, to: [para],
        subject: novo ? 'Seu acesso ao sistema de Não Conformidades — Melting' : 'Nova senha provisória — Melting NC',
        html: htmlSenha(nome, login, senha, novo), text: texto,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) return { enviado: true, para };
    const det = await r.text().catch(() => '');
    console.error('Resend', r.status, det);
    return { enviado: false, para, motivo: `O serviço de e-mail recusou o envio (${r.status}).` };
  } catch (e) {
    console.error('Resend', e);
    return { enviado: false, para, motivo: 'Não foi possível contatar o serviço de e-mail.' };
  }
}

