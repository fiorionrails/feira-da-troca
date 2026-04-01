# Análise Frontend — Ouroboros

**Projeto:** Sistema POS de economia circular escolar
**Stack:** React 19 + Vite 8 + WebSocket + Recharts
**Data:** Abril 2026

---

## 1. Visão Geral da Arquitetura

O Ouroboros é um sistema de ponto de venda (POS) para economia circular escolar com três interfaces: Login, Admin (Banco Central) e Store (Terminal da Loja), mais um dashboard público de Analytics. A comunicação em tempo real usa WebSocket, e o estado é gerenciado localmente com hooks customizados.

**Estrutura de pastas:**

```
src/
├── App.jsx              # Rotas (BrowserRouter)
├── main.jsx             # Entry point
├── index.css            # Design system (variáveis CSS, glassmorphism)
├── config.js            # URLs do backend (env vars)
├── components/
│   ├── Header.jsx       # Header reutilizável (logo, clock, status WS, theme toggle)
│   └── Layout.jsx       # Wrapper (Header + main content)
├── context/
│   └── ThemeContext.jsx  # Dark/Light mode com persistência (localStorage)
├── hooks/
│   ├── useAdminWebSocket.js  # Hook WS para o painel admin
│   └── useStoreWebSocket.js  # Hook WS para o terminal da loja
├── pages/
│   ├── Login.jsx
│   ├── admin/
│   │   ├── Dashboard.jsx    # Painel do Banco Central
│   │   └── Analytics.jsx    # Dashboard público com gráficos
│   └── store/
│       └── Terminal.jsx     # Terminal POS da loja
└── utils/
    └── sound.js             # Web Audio API (beeps de sucesso/erro)
```

---

## 2. BUGS — Problemas que Quebram o App

### 2.1. `Zap` não importado no Analytics.jsx

**Arquivo:** `src/pages/admin/Analytics.jsx` — linha 280
**O que acontece:** O componente `<Zap>` do lucide-react é usado na seção "Feed Ao Vivo", mas nunca foi importado no topo do arquivo. Isso causa um **ReferenceError** em runtime e a página de Analytics não renderiza.

**Como funciona por baixo:** O React tenta avaliar o JSX `<Zap size={18} .../>`, mas `Zap` não existe no escopo do módulo. O erro borbulha e, sem um Error Boundary, derruba toda a árvore de componentes.

**Correção:** Adicionar `Zap` na lista de imports do lucide-react:
```js
import { Activity, Users, Coins, TrendingUp, Store, ShoppingCart, Zap } from 'lucide-react'
```

### 2.2. Variáveis CSS inexistentes (fantasmas)

**Afeta:** Dashboard.jsx, Terminal.jsx, Analytics.jsx (30+ ocorrências)

O código usa extensivamente três variáveis CSS que **não existem** em `index.css`:

| Variável usada | Definida? | Efeito |
|---|---|---|
| `var(--accent-primary)` | **NÃO** | Texto de destaque fica invisível ou com cor padrão do browser |
| `var(--success)` | **NÃO** | Cores de saldo, confirmações ficam sem estilo |
| `var(--border-glass)` | **NÃO** | Bordas de seções e dropdowns desaparecem |

**Como funciona por baixo:** Quando o CSS encontra um `var(--nome)` que não existe e não tem fallback, ele resolve como `initial` (valor padrão da propriedade). Para `color`, isso vira preto; para `border-color`, pode virar transparente. O resultado é uma UI visualmente quebrada, mas sem erros no console.

**Correção:** Adicionar ao `:root` no `index.css`:
```css
--accent-primary: var(--lime-primary);  /* #349754 */
--success: #10b981;
--border-glass: var(--border-lime);
```

### 2.3. Função de sort inválida

**Arquivo:** `src/pages/admin/Dashboard.jsx` — linha 444
```js
.sort((a,b) => -1)
```

**O que acontece:** Um comparador que sempre retorna `-1` viola a especificação de `Array.prototype.sort`, que espera resultados consistentes (negativo, zero, positivo). O comportamento varia entre engines de JS — no V8 pode até funcionar "por acaso", mas no SpiderMonkey (Firefox) pode gerar ordenação aleatória.

**Correção:** Se a intenção é mostrar os mais recentes primeiro, usar timestamp ou índice:
```js
.sort((a, b) => (b._ts || 0) - (a._ts || 0))
```

---

## 3. PROBLEMAS DE UI/UX

### 3.1. Zero responsividade — Mobile quebrado

O layout inteiro é baseado em grids com colunas fixas:

- **Dashboard:** `gridTemplateColumns: 'minmax(300px, 1.2fr) minmax(350px, 1fr) 1fr'` — exige mínimo de ~1000px
- **Terminal:** `gridTemplateColumns: 'minmax(350px, 1fr) minmax(350px, 1fr)'` — exige mínimo de ~700px
- **Header:** Muitos elementos lado a lado sem wrapping

Em telas menores que ~1000px, o layout simplesmente transborda horizontalmente. Não há media queries, não há breakpoints, não há versão mobile.

**Impacto:** Se o sistema for usado em tablets (cenário comum para POS escolar), a experiência é inutilizável.

### 3.2. Dropdown sem fechar ao clicar fora

**Afeta:** Dashboard.jsx e Terminal.jsx (carrinho de categorias)

O dropdown de autocomplete abre com `onFocus` e atualiza com `onChange`, mas não tem listener para cliques fora do componente. Uma vez aberto, o dropdown só fecha se o usuário selecionar um item ou limpar o texto.

**Como funciona por baixo:** Faltaria um `useEffect` com `document.addEventListener('mousedown', handler)` que verifica se o clique foi dentro ou fora do container do dropdown, e fecha se for fora.

### 3.3. `window.prompt()` e `window.alert()` no Dashboard

**Arquivo:** `src/pages/admin/Dashboard.jsx` — `handleCreateCategory()`

O código usa `window.prompt()` para pedir o preço de uma nova categoria e `window.alert()` para erros. Isso quebra completamente a estética premium do glassmorphism e parece um site de 2005. Em mobile, os prompts nativos são especialmente feios e confusos.

**Solução ideal:** Modal customizado seguindo o mesmo padrão visual da modal de lojas.

### 3.4. Login sem feedback de erro

O fluxo atual é: digita token → clica "ENTRAR" → redireciona para /admin ou /store → WebSocket tenta conectar → se token inválido, WS fecha com code 1008 → redireciona de volta para "/".

**Problema:** O usuário é devolvido ao login sem nenhuma mensagem explicando o que aconteceu. Parece que a página simplesmente recarregou. O `wsError` é setado nos hooks, mas a tela de Login não tem acesso a ele.

### 3.5. Acessibilidade (a11y) praticamente inexistente

- Nenhum `aria-label` nos botões de ícone (tema, analytics, logout)
- Dropdown de categorias não é navegável por teclado (sem `role="listbox"`, sem `aria-expanded`, sem navegação por setas)
- Botões `+`/`-` de quantidade sem contexto (`aria-label="Aumentar quantidade de {item}"`)
- Status de conexão WebSocket não é anunciado a screen readers
- Modal de lojas não faz trap de foco

---

## 4. PROBLEMAS DE ARQUITETURA

### 4.1. Código duplicado — Carrinho

O componente de carrinho (busca de categorias, dropdown, lista de itens, +/-, remover, total) é **praticamente idêntico** entre `Dashboard.jsx` e `Terminal.jsx`. São ~100 linhas copiadas e coladas com mínimas diferenças.

**Por que isso importa:** Se precisar corrigir um bug no carrinho, tem que lembrar de corrigir nos dois arquivos. Se adicionar uma feature (ex: desconto), precisa implementar duas vezes. É o cenário clássico do princípio DRY violado.

**Solução:** Extrair um componente `<Cart>` reutilizável que recebe props como `onCartChange`, `allowCreateCategory`, etc.

### 4.2. Sem proteção de rotas

Qualquer pessoa pode acessar `/admin` diretamente digitando na URL. A "proteção" depende do WebSocket rejeitar o token e redirecionar — mas há uma janela onde o dashboard renderiza sem dados, e a experiência é confusa.

**Solução:** Componente `<ProtectedRoute>` que verifica sessionStorage antes de renderizar:
```jsx
function ProtectedRoute({ children }) {
  const token = sessionStorage.getItem('ouroboros_token')
  if (!token) return <Navigate to="/" replace />
  return children
}
```

### 4.3. Inline styles massivo vs. CSS organizado

Praticamente toda a estilização é feita com objetos JavaScript inline (`style={{ ... }}`). Isso:

- Impossibilita media queries (responsividade)
- Impossibilita pseudo-elementos (`:hover`, `:focus-visible`)
- Dificulta manutenção (estilos espalhados pela lógica)
- Aumenta o tamanho do DOM (cada estilo é replicado no HTML)
- A tentativa de hover no Header.jsx (linha 255 — `'@media (max-width: 640px)'` dentro de objeto JS) simplesmente **não funciona**

O Header.jsx contém um workaround revelador: injeta uma `<style>` tag manualmente para ter `@keyframes` e `:hover`. Isso mostra que o inline styling está limitando o projeto.

**Solução:** Migrar para CSS Modules (`.module.css`) ou styled-components, que permitem media queries, pseudo-classes, e mantêm o escopo por componente.

### 4.4. Sem Error Boundaries

Se qualquer componente filho lançar um erro (como o bug do `Zap` não importado), toda a aplicação cai com tela branca. O React 19 suporta Error Boundaries que capturam erros e mostram um fallback amigável.

---

## 5. PONTOS POSITIVOS

O projeto tem vários acertos que merecem reconhecimento:

**Design system com CSS variables:** A base de variáveis no `:root` com dark/light mode é bem pensada. A paleta verde sustentável é coerente com o tema de economia circular. O glassmorphism (blur + transparência) dá um aspecto moderno.

**WebSocket hooks bem estruturados:** Os hooks `useAdminWebSocket` e `useStoreWebSocket` são limpos, tratam reconexão automática, limpam state corretamente no unmount, e separam bem as responsabilidades. O pattern de `useRef` para o WS + `useCallback` para as ações é o idiomático do React.

**Feedback sonoro:** O `playSound()` via Web Audio API é um toque excelente para um POS. O beep de sucesso (onda senoidal ascendente) e erro (sawtooth descendente) dão feedback imediato sem depender de arquivos de áudio.

**AnimatedNumber no Analytics:** A animação easeOut com `requestAnimationFrame` para transição suave dos KPIs é um detalhe premium que faz o dashboard parecer profissional.

**ThemeContext bem implementado:** Context simples, persistência em localStorage, `data-theme` no root — é exatamente o padrão recomendado.

**Live feed em tempo real:** A combinação de polling (3s) para dados agregados + WebSocket para eventos individuais no Analytics é uma boa arquitetura que balanceia consistência com responsividade.

---

## 6. RESUMO DE PRIORIDADES

| Prioridade | Issue | Impacto |
|---|---|---|
| **CRÍTICO** | Import do `Zap` faltando | Analytics não renderiza |
| **CRÍTICO** | Variáveis CSS fantasmas (30+ refs) | UI visualmente quebrada |
| **ALTO** | Zero responsividade | Inutilizável em tablets |
| **ALTO** | Carrinho duplicado (DRY) | Manutenção dobrada |
| **MÉDIO** | Sort inválido | Ordenação imprevisível entre browsers |
| **MÉDIO** | Dropdown não fecha ao clicar fora | UX irritante |
| **MÉDIO** | window.prompt/alert | Quebra a estética premium |
| **MÉDIO** | Login sem feedback de erro | Usuário confuso |
| **BAIXO** | Proteção de rotas | Segurança client-side |
| **BAIXO** | Acessibilidade | Compliance e inclusão |
| **BAIXO** | Error boundaries | Resiliência |

---

*Análise realizada sobre o código fonte estático. Alguns comportamentos podem variar dependendo do backend e do ambiente de execução.*
