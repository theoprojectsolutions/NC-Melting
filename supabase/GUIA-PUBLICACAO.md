# Publicar o Melting NC: Supabase + Hostinger (Opção B)

Funcionamento:

- **Telas** (pasta `public/`): ficam na Hostinger, em `https://nc-melting.com.br`.
- **Servidor e banco**: ficam no Supabase.
  - O servidor é a Edge Function `api` (`supabase/functions/api/index.ts`). Ela tem as mesmas regras do `server.py`: permissões, fluxo das etapas, histórico e anexos.
  - O banco são as tabelas do schema `nc` (`supabase/schema.sql`).

O `server.py` continua funcionando para uso na rede interna, sem mudança.

## Como atualizar o sistema (GitHub → Hostinger automático)

O código fica em **github.com/theoprojectsolutions/NC-Melting**:

- **`main`**: o projeto completo. É aqui que se fazem as mudanças.
- **`site`**: só as telas. Não mexa nele à mão: a ação **Publicar site** (`.github/workflows/publicar-site.yml`) o atualiza sozinha sempre que `public/` muda na `main`.
- A Hostinger (**Avançado → GIT**) está ligada ao ramo `site` e implanta automaticamente na `public_html`. Em menos de 1 minuto a mudança está no ar.

Regras:
1. **Nunca edite arquivos direto na `public_html`.** A próxima publicação sobrescreve.
2. Telas: altere `public/` na `main` e envie (`git push`).
3. Servidor: altere `supabase/functions/api/` e publique no Supabase (veja abaixo). A Hostinger não publica o servidor.
4. Se algo quebrar: no GitHub, reverta o último commit da `main` e a versão anterior volta ao ar sozinha.

## 1. Banco de dados (Supabase)

1. No projeto `melting-nc`, abra **SQL Editor → New query**.
2. Cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. Confira em **Table Editor → schema `nc`**: devem aparecer as tabelas `users`, `sessions`, `ncs`, `anexos`, `kv` e `login_fails`.

## 2. Servidor (Edge Function)

1. Abra **Edge Functions → Deploy a new function → Via Editor**.
2. **Nome da função:** `api`. O nome precisa ser exatamente esse.
3. Apague o código de exemplo e cole todo o conteúdo de `supabase/functions/api/index.ts`.
4. Em **Function settings**, **desligue "Verify JWT"**. O sistema usa o próprio login.
5. Clique em **Deploy**.
6. Copie a URL da função. Ela tem este formato: `https://<id-do-projeto>.supabase.co/functions/v1/api`

Para testar, abra no navegador `https://<id-do-projeto>.supabase.co/functions/v1/api/status`. Deve aparecer `{"setup": true, ...}`.

## 3. Telas (Hostinger)

1. Abra o arquivo `public/config.js` e coloque a URL da função:
   ```js
   window.NC_API = 'https://<id-do-projeto>.supabase.co/functions/v1/api';
   ```
2. No hPanel, abra **Sites → nc-melting.com.br → Arquivos → Gerenciador de Arquivos** e entre na pasta `public_html`.
3. Apague o que estiver lá, como um `default.php` ou `index.php` de exemplo.
4. Envie **o conteúdo** da pasta `public/` (não a pasta em si): `index.html`, `app.js`, `styles.css`, `config.js`, `.htaccess` e a pasta `assets`.
   - Dica: envie o `site-hostinger.zip` e use **Extrair** dentro da `public_html`.
5. Em **Segurança → SSL**, confira se o certificado está ativo. Ele pode levar algumas horas depois que o domínio termina de registrar.

## 4. Primeiro acesso

1. Abra `https://nc-melting.com.br`. Aparece a tela **Configuração inicial**: crie o **Administrador**.
2. **Se for trazer as NCs da rede interna:** no sistema antigo, vá em **Configurações → Baixar backup**. No sistema novo, entre como admin e use **Configurações → Importar backup**. Os usuários não vêm junto no backup, então cadastre-os de novo em **Usuários**.

## Segurança

- O schema `nc` não fica exposto pela API pública do Supabase. Todas as tabelas têm RLS ligado e nenhuma política, então só a função `api` acessa os dados.
- O login é por token, guardado no navegador e enviado em cada chamada. As senhas usam o mesmo formato seguro do `server.py` (PBKDF2-SHA256).
- Cinco senhas erradas seguidas bloqueiam o IP por 60 segundos.
- Opcional: em **Edge Functions → Secrets**, crie `NC_ALLOWED_ORIGIN = https://nc-melting.com.br`. Assim, só o site oficial consegue chamar o servidor.

## E-mail da senha provisória (Resend)

Quando o admin cadastra um usuário ou gera uma nova senha, o servidor manda a senha provisória para o e-mail cadastrado (arquivo `supabase/functions/api/email.ts`).

- O domínio `nc-melting.com.br` fica verificado no Resend, com os registros DNS cadastrados na Hostinger.
- Em **Supabase → Edge Functions → Secrets**:
  - `RESEND_API_KEY`: chave do Resend (obrigatória).
  - `NC_EMAIL_FROM` (opcional): remetente. O padrão é `Melting NC <nao-responda@nc-melting.com.br>`.
  - `NC_SITE_URL` (opcional): endereço do sistema. O padrão é `https://nc-melting.com.br`.
- Se o envio falhar, o cadastro continua normalmente e a tela mostra ao admin o motivo e a senha, para ele repassar manualmente.

## Atualizar o servidor

1. Altere os arquivos em `supabase/functions/api/` (`index.ts` e `email.ts`).
2. Publique com a CLI do Supabase: `supabase functions deploy api --no-verify-jwt --project-ref ijygptkydlhwpjmshxjh`.
   - Mantenha **Verify JWT desligado**, porque o sistema usa o próprio login.
3. Teste em `https://ijygptkydlhwpjmshxjh.supabase.co/functions/v1/api/status`.

## Backup

- **Banco:** o Supabase Pro faz backup diário automático e guarda 7 dias. Para restaurar, vá em **Database → Backups**.
- **Recomendado:** uma vez por semana, o admin baixa o backup completo em **Configurações → Baixar backup** e guarda na rede da Melting.
