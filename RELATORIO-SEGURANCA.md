# Relatório de Segurança — Agenda+

**Data:** 04/11/2026 · **Branch:** `feat/auth-redesign-docker` · **Escopo:** API (Express + Prisma), painel web (Next.js), app mobile (Expo), Docker, CI e histórico do git.

> ⚠️ Este ficheiro descreve pontos fracos que ainda faltam resolver. Se o repositório for público, não o publique no git.

## Resumo

O projeto já tinha uma base de segurança forte (tokens JWT com finalidade/emissor, sessões revogáveis, deteção de roubo de refresh token, CORS restrito, CSP, validação Zod em todas as rotas, consultas parametrizadas). A revisão encontrou **9 falhas ou lacunas, todas corrigidas no código**, e **8 ações que só você pode fazer** (painéis da Google, Neon e Render).

| Resultado dos testes | Antes | Depois |
|---|---|---|
| Testes unitários | 68 ✅ | 83 ✅ (+15 novos) |
| Testes de integração (Postgres real) | 117 ✅ | 127 ✅ (+10 novos) |
| Typecheck + lint da API | ✅ | ✅ |
| Build do painel web | ✅ | ✅ |

Além dos testes automáticos, as proteções foram testadas ao vivo (API em modo produção e painel rodando): ataque CSRF → 403, HTTP puro → 403, Swagger em produção → 404, seed contra banco remoto → ignorado.

---

## Falhas encontradas e corrigidas

### 🔴 1. Contas de demonstração com senha pública podiam ir para produção — ALTA
**O problema:** o container da API roda `prisma/seed.ts` **a cada arranque**, criando `owner@slotix.dev`, `employee@slotix.dev` e `customer@slotix.dev` com a senha `password123` (publicada no README e no docker-compose). Se a imagem fosse usada em produção, ou se `npm run seed` rodasse com o `.env` local (que aponta para o banco **Neon de produção**), qualquer pessoa entraria como dono de um negócio.
**Correção:** `prisma/seedGuard.ts` — o seed só roda num banco local (`localhost`, `db`, …) e fora de produção. Noutro caso termina com sucesso sem criar nada (o servidor arranca normalmente). `ALLOW_DEMO_SEED=true` força, de propósito.

### 🟠 2. Sem registro nem monitoramento de atividade suspeita — MÉDIA
**O problema:** logins falhados, tokens inválidos, tentativas de acessar dados de outro negócio e limites atingidos não deixavam rasto. Um ataque passaria despercebido.
**Correção:** `src/shared/securityLog.ts` + ligação no `errorHandler`. Toda recusa (401/403/429) gera uma linha `[security] {json}` com IP, utilizador, rota e motivo. Também ficam registados: mudança de senha, "terminar todas as sessões", conta apagada, **reutilização de refresh token** (sinal de roubo), CSRF bloqueado e HTTP recusado. Quando um IP ou uma conta passa de **20 falhas em 15 min**, sai um alerta `suspicious_activity` (um por janela). Emails aparecem só como hash; senhas e tokens nunca são registados.

### 🟠 3. CSRF dependia apenas do SameSite do cookie — MÉDIA
**O problema:** o cookie de sessão é `httpOnly` + `SameSite=Lax` (bom), mas não havia uma segunda barreira. Browsers antigos ou um erro futuro de configuração deixariam outro site apagar a conta ou terminar sessões em nome do utilizador.
**Correção:** `apps/web/lib/csrf.ts` + `proxy.ts`. Todo `POST/PUT/PATCH/DELETE` em `/api/*` vindo de outro site (`Sec-Fetch-Site` ou `Origin`) recebe 403.

### 🟠 4. HTTPS não era exigido pela API — MÉDIA
**O problema:** havia HSTS, mas um pedido que chegasse por HTTP puro era atendido normalmente, com o token já enviado em claro.
**Correção:** em produção, pedidos com `X-Forwarded-Proto: http` recebem 403 `HTTPS_REQUIRED` (recusa, não redirecionamento, para o cliente não reenviar o token). `/health` continua aberto.

### 🟠 5. Senhas muito comuns eram aceites — MÉDIA
**O problema:** a única regra era ter 8+ caracteres, então `12345678` e `password123` eram válidas.
**Correção:** lista de bloqueio com as senhas mais usadas (incluindo variantes locais como `senha123`, `luanda123`), aplicada no servidor ao registo e à mudança de senha. Segue a orientação do NIST (bloqueio + comprimento, sem regras de composição).

### 🟡 6. Banco do Docker exposto à rede local — BAIXA
**O problema:** o Postgres do `docker-compose.yml` publicava a porta em `0.0.0.0` com senha `agenda`. Qualquer pessoa no mesmo Wi-Fi podia acessá-lo.
**Correção:** porta publicada só em `127.0.0.1`.

### 🟡 7. Respostas da API podiam ficar em cache — BAIXA
**Correção:** `Cache-Control: no-store` em todas as respostas JSON (tokens e dados pessoais). O canal ao vivo (SSE) mantém o seu cabeçalho próprio.

### 🟡 8. Uploads sem limite de ficheiros/campos por pedido — BAIXA
O tamanho (5 MB), o tipo e os **bytes reais** da imagem já eram verificados (um HTML disfarçado de PNG é recusado).
**Correção:** configuração única (`src/shared/middleware/upload.ts`) com no máximo 1 ficheiro, 5 campos e 8 KB por campo, usada nos três pontos de upload (avatar, logótipo, galeria).

### 🟡 9. Variáveis de ambiente fracas passavam em silêncio — BAIXA
**Correção:** no arranque em produção, a API agora avisa (`[segurança] …`) se um segredo JWT ainda é o valor de exemplo, se os dois segredos são iguais ou curtos, se há origens sem `https`, se o banco remoto não exige SSL, ou se o Swagger está público.

### Outras mudanças
- **Pacote não usado removido:** `expo-glass-effect` (app mobile). Continua instalado como dependência interna do `expo-router`, então nada quebra.
- **Cabeçalho novo no painel:** `Cross-Origin-Opener-Policy: same-origin`.

---

## Verificado e já correto (sem alterações)

| Item | Situação |
|---|---|
| **Autenticação** | JWT HS256 com `typ`/`aud`/`iss`, sessões revogáveis, rotação de refresh token com deteção de roubo, papel lido do banco a cada pedido |
| **Hash de senhas** | bcrypt (custo 10), comparação de tempo constante mesmo para email inexistente |
| **Consultas SQL** | Prisma em todo lado; as 3 consultas cruas usam templates parametrizados. Nenhuma concatenação |
| **Validação no servidor** | Zod em todos os corpos e queries, com limites de tamanho em todos os textos |
| **XSS** | React escapa por padrão; o único `dangerouslySetInnerHTML` é um script fixo de tema; os dados nos mapas do app são escapados (`<` → `<`); URLs de imagem só `https:` ou `data:image` |
| **Rotas de admin** | Protegidas por `authorize("ADMIN")`; nenhum formulário aceita o campo `role` (sem auto-promoção) |
| **Rate limit** | Login (10/15 min por conta), registo, refresh, OAuth, mudança de senha |
| **CORS** | Em produção só `WEB_URL`/`CORS_ORIGINS`; nunca "qualquer origem" |
| **Cabeçalhos** | CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, sem X-Powered-By (API e painel) |
| **Cookies de sessão** | `httpOnly`, `SameSite=Lax`, `Secure` em produção |
| **Preços e pagamentos** | Valor, moeda e cliente vêm sempre do agendamento no servidor; só o negócio confirma ou reembolsa; transições protegidas contra corrida |
| **Debug em produção** | Swagger desligado; erros 500 genéricos, sem stack trace para o cliente |
| **Ficheiros expostos** | `.env` fora do git e da imagem Docker; o `.env.production` versionado só tem URLs públicas |
| **Segredos no histórico do git** | 48 commits analisados, incluindo comparação direta com os valores reais dos seus `.env`: **nenhum segredo vazado** (só placeholders `change-me`) |
| **App mobile** | Tokens no SecureStore (cofre do sistema) |
| **Senhas temporárias de funcionários** | 72 bits aleatórios criptográficos, mostradas uma única vez |
| **Links de redefinição de senha** | **Não existe** fluxo "esqueci a senha", então não há links a expirar (ver recomendação 7) |

---

## Ações que só você pode fazer

1. **Restringir as chaves do Google Maps (urgente).** As chaves `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` e `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_*` vão para o browser e para o app, ou seja, são **públicas por natureza**. Na Google Cloud Console → Credenciais, limite cada uma: web por *HTTP referrer* (`agenda-nivrix.vercel.app/*`), Android por *nome do pacote + SHA-1*, iOS por *bundle ID*, e só às APIs que usa. Sem isso, qualquer pessoa pode gastar a sua cota.
2. **Verificar contas de demonstração em produção.** Procure no Neon por `owner@slotix.dev`, `employee@slotix.dev` e `customer@slotix.dev`. Se existirem, apague-as ou troque as senhas.
3. **Separar o banco de desenvolvimento.** O `apps/api/.env` local está em `NODE_ENV=development` mas aponta para o **Neon de produção** com o utilizador dono (`neondb_owner`). Crie um *branch* de desenvolvimento no Neon (ou use o Postgres do Docker) e, em produção, um utilizador com permissões mínimas.
4. **Rotação de chaves:** como nada vazou no git, **não há chave comprometida a revogar**. Se o seu computador ou o `.env` foram partilhados com alguém (ou com ferramentas na nuvem), troque `JWT_*_SECRET` (isso termina todas as sessões), `GOOGLE_CLIENT_SECRET` e a senha do Neon.
5. **Configurar em produção (Render/Vercel):** `INTERNAL_PROXY_SECRET` (o mesmo valor nos dois), `TRUSTED_CLIENT_IP_HEADER=x-real-ip` na Vercel, `TRUST_PROXY=1` no Render e `JWT_OAUTH_SECRET`. Depois do deploy, veja os logs: qualquer linha `[segurança]` aponta uma configuração a corrigir.
6. **Criar um alerta nos logs** do Render para o texto `suspicious_activity`.

## Recomendações para depois (não feitas: exigem decisões ou migrações)

7. **"Esqueci a senha":** se criar esse fluxo, use um token aleatório de uso único, guarde só o hash, faça-o expirar em 15–60 min e termine todas as sessões ao redefinir.
8. **Senha temporária de funcionário:** hoje não expira nem obriga a trocar no primeiro login. É preciso um campo novo no banco (migração).
9. **Dependências:** restam 2 alertas *altos* e 16 *moderados*, **todos em ferramentas de desenvolvimento** (ESLint, CLI do Expo), nenhum no código que roda em produção. O `npm audit fix` é bloqueado por um conflito com o TypeScript 7; resolva quando atualizar o Expo e o eslint-config-next.
10. **CSP com `script-src`** no painel (exige nonces no Next), **cookie com prefixo `__Host-`**, e **bcrypt com custo 12**.
11. **Rate limit e alertas guardam-se em memória:** com mais de uma instância da API, passe para Redis.

---

## Ficheiros alterados

**Novos:** `apps/api/src/shared/securityLog.ts`, `apps/api/src/shared/middleware/upload.ts`, `apps/api/prisma/seedGuard.ts`, `apps/web/lib/csrf.ts`, `apps/api/tests/securityHardening.test.ts`, `apps/api/tests/integration/security-hardening.test.ts`

**Modificados:** `apps/api/src/app/app.ts`, `apps/api/src/config/env.ts`, `apps/api/src/shared/middleware/errorHandler.ts`, `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/modules/users/{users.service,users.schema,users.routes}.ts`, `apps/api/src/modules/{businesses,gallery}/*.routes.ts`, `apps/api/prisma/seed.ts`, `apps/api/.env.example`, `apps/api/tsconfig.test.json`, `packages/validation/src/index.ts`, `apps/web/proxy.ts`, `apps/web/next.config.ts`, `docker-compose.yml`, `apps/mobile/package.json`, `package-lock.json`

Nada foi commitado.
