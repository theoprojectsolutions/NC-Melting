# Melting · Gestão de Não Conformidades

Sistema multiusuário para registro e tratamento de NCs (contenção → análise de causa → plano de ação 5W2H → verificação de eficácia → encerramento).

## 1. Colocar no ar (uma vez)

1. Escolha **um computador que fique ligado** durante o expediente (ou um servidor da empresa).
2. Ele precisa ter **Python 3.9 ou superior** (https://www.python.org/downloads/ — na instalação, marque *Add python.exe to PATH*). Não é preciso instalar mais nada.
3. Copie esta pasta inteira para esse computador.
4. Dê dois cliques em **`iniciar-servidor.bat`**. A janela mostra os endereços de acesso, por exemplo:
   ```
   Neste computador:  http://localhost:8080
   Na rede:           http://192.168.0.25:8080
   ```
5. Na primeira vez, o Windows pergunta sobre o **Firewall**: clique em **Permitir acesso** (redes privadas). Sem isso, os outros computadores não conseguem acessar.
6. Abra o endereço no navegador. Na primeira vez aparece a tela **Configuração inicial**, onde você cria o usuário **Administrador**.

> Com o `iniciar-servidor.bat`, mantenha a janela aberta: se fechá-la, o sistema sai do ar (os dados não se perdem). Para rodar sem janela e iniciar com o Windows, veja o item 3.

## 2. Acesso pelos demais usuários

- O administrador cadastra cada pessoa em **Usuários → Novo usuário**. O sistema gera uma **senha provisória** que deve ser passada à pessoa, junto com o endereço *Na rede*. No primeiro acesso ela define a própria senha.
- Use no cadastro o **mesmo nome** que será usado no campo *Responsável* das NCs — é assim que o sistema sabe quem pode tratar cada NC e monta a tela *Minhas pendências*.
- Funciona em qualquer navegador moderno (Chrome, Edge, Firefox), inclusive no celular conectado ao Wi-Fi da empresa.

### Perfis

| Perfil | Pode |
|---|---|
| **Administrador** | **Vê todo o cenário** (todas as NCs). É o **único que cancela** e exclui NCs. Usuários, configurações (setores, tipos, origens, prefixo), backup/importação. |
| **Qualidade** | Vê só as suas NCs. Avança e retorna etapas e reabre. Encerra apenas se for gestor da área (ou se o setor ainda não tiver gestor). Não cancela. |
| **Colaborador** | Vê só as suas NCs. Registra NCs e trata as que registrou, as que tem como responsável e as do setor em que é gestor. Não cancela e não reabre. |

### Quem vê cada NC

O **administrador** vê todas. Os demais usuários veem apenas **as suas pendências** — as NCs em que:

- é o **responsável** pelo tratamento (ou por alguma ação);
- **registrou** a NC;
- é o **gestor da área** do setor da NC;
- precisa **autorizar o encerramento** (NC em *Aguardando autorização* de um setor sem gestor, para a Qualidade).

Isso vale para o Painel, a lista, o Kanban, a exportação e os anexos — o servidor não entrega as NCs dos outros.

### Filtros do Kanban

No topo do **Kanban de gestão** há filtros por **responsável, setor, cliente, severidade, prazo** (atrasadas, vencendo, no prazo) e **período da ocorrência**, além da busca por texto. Os filtros ficam salvos no navegador; use **Limpar** para voltar a ver tudo.

### Hierarquia dos setores

Em **Configurações → Setores / áreas** cada setor tem um **gestor da área** e uma **equipe** (usuários).

- O **encerramento** da NC é feito pelo **gestor da área** do setor da NC (o administrador também pode).
- O gestor é sugerido como responsável ao escolher o setor e vê as NCs da área em *Minhas pendências*.
- A equipe pode tratar as NCs do seu setor quando for o responsável por elas.
- Ao abrir a NC é obrigatório responder **"Houve custo logístico?"**. Se **Sim**, o **valor do custo logístico** passa a ser obrigatório; ele é somado ao prejuízo estimado no **prejuízo total** da NC (Painel, impressão e Excel).
- O **custo médio ADM / Operação** do setor é usado como **prejuízo estimado** quando a NC é registrada sem valor (o usuário pode trocar o valor a qualquer momento).

### Fluxo

Aberta → Em análise → Encerrada. O plano de ação 5W2H e a verificação de eficácia estão desativados por enquanto (para reativar: `PLANO_ACAO = True` em `server.py` e `PLANO_ACAO = true` em `public/app.js`).

As regras são verificadas no servidor, e o **histórico** de cada NC (quem fez o quê e quando) é gravado pelo servidor.

## 3. Servidor sem janela, iniciando com o Windows

Neste computador já está configurado:

- O servidor **inicia sozinho quando o Windows liga** e roda **sem janela** (não há o que fechar sem querer). O atalho fica em `shell:startup` → *Melting NC - servidor*.
- **Atalho "Melting NC" na área de trabalho**: abre o sistema no navegador e, se o servidor estiver desligado, liga antes.

| Arquivo | Para quê |
|---|---|
| `abrir-sistema.bat` | Liga o servidor (se preciso) e abre o sistema no navegador |
| `parar-servidor.bat` | Desliga o servidor (o sistema sai do ar para todos) |
| `iniciar-servidor-oculto.vbs` | Liga o servidor sem janela (é o que roda na inicialização do Windows) |
| `iniciar-servidor.bat` | Liga o servidor **com** janela, útil para ver mensagens. Pare o oculto antes |
| `data\ENDERECOS.txt` | Endereços para acessar pela rede (atualizado a cada início) |
| `data\servidor.log` | Registro de funcionamento e erros do servidor |

Para **desativar** o início automático: `Win + R` → `shell:startup` → apague *Melting NC - servidor*.

Para configurar em **outro computador**: copie a pasta e crie, em `shell:startup`, um atalho para `iniciar-servidor-oculto.vbs`.

## 4. Backup

- Cópia automática **diária** do banco em `data\backups` (guarda os últimos 30 dias).
- Em **Configurações → Baixar backup** o administrador baixa tudo (com anexos) em um arquivo `.json`.
- Recomenda-se copiar a pasta `data` periodicamente para outro local (pen drive, rede, nuvem).
- Para restaurar a partir de um arquivo diário: pare o servidor, substitua `data\melting-nc.db` pelo arquivo de backup desejado (renomeando-o) e inicie novamente.

## 5. Trazer dados da versão anterior (uso individual)

Se você usou a versão anterior (que salvava no navegador), abra-a, vá em **Configurações → Exportar backup** e, no sistema novo, entre como administrador e use **Configurações → Importar backup**.

## Opções avançadas

```
python server.py --port 9000          # outra porta
python server.py --data D:\NC-dados   # guardar o banco em outra pasta
```

## Arquivos

- `server.py` — servidor (Python, somente biblioteca padrão)
- `public\` — telas do sistema (HTML/CSS/JS e logotipo)
- `data\` — banco de dados SQLite e backups (criada automaticamente)
