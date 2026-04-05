# Desenvolvimento com IA

> *"A ferramenta não cria o projeto. Cria quem sabe o que quer."*

---

## Por que documentar isso?

Este projeto foi desenvolvido com assistência ativa de **agentes de IA generativa** — especificamente o **GitHub Copilot** (no modo agente) e o **Claude** (Anthropic). Não como autocomplete glorificado, mas como colaboradores na execução de decisões de engenharia que eu já havia tomado.

Documentar isso não é modéstia nem vaidade. É **honestidade técnica**: quem quiser entender como o projeto evoluiu, contribuir, ou replicar a metodologia precisa saber que o loop humano–máquina foi deliberado e estruturado — não acidental.

---

## A metodologia: Spec-Driven Development

O processo seguiu uma abordagem que pode ser chamada de **spec-driven development**: ao invés de codificar diretamente, a maior parte do trabalho intelectual foi convertida em **especificações precisas** — descrições rigorosas de comportamento, invariantes, contratos de API, critérios de aceitação — e os agentes foram instruídos a executá-las dentro desses contratos.

O ciclo era aproximadamente:

```
Eu defino o problema e as invariantes
        ↓
Escrevo a spec (comportamento esperado, edge cases, restrições)
        ↓
Agente executa (GitHub Copilot agent / Claude)
        ↓
Eu reviso, questiono, refuto ou aceito
        ↓
Feedback realimenta a próxima spec
```

Isso não é diferente de como um engenheiro sênior trabalha com um júnior de alta capacidade técnica — exceto que o "júnior" executa em segundos, nunca fica entediado com repetição, e não tem opiniões sobre o que você *deveria* querer.

### O que eu especifiquei, o que o agente executou

| Domínio | Decisão minha (arquitetural) | Execução assistida por IA |
|---|---|---|
| Persistência | SQLite com WAL mode, event sourcing, `balance_view` derivada | Schema SQL, migrations, consultas |
| Concorrência | WebSocket broadcasting segregado por papel (admin/store) | Implementação dos handlers, tracking de conexões |
| Segurança | Validação backend-authoritative, nenhuma confiança no frontend | Input parsing, middleware de autenticação |
| Resiliência | Local-first, sem dependência de internet para operação crítica | Reconexão automática, tratamento de erros de rede |
| API | Contratos REST + WebSocket definidos antes da implementação | Implementação dos endpoints, serialização/deserialização |

---

## As ferramentas

### GitHub Copilot (modo agente)

Usado principalmente para **implementação de features a partir de specs no contexto do repositório**. O modo agente permite que o Copilot leia o codebase completo, entenda convenções existentes, e gere código que respeita o estilo e os padrões já estabelecidos — sem precisar reexplicar o projeto a cada sessão.

Casos de uso centrais:
- Implementar novos endpoints REST seguindo os já existentes
- Adicionar validação seguindo os utilitários (`parsePositiveInt`, `parseNonNegativeInt`) já definidos
- Gerar documentação técnica sincronizada com o código

### Claude (Anthropic)

Usado para **raciocínio sobre design**, **trade-offs arquiteturais**, e **geração de documentação complexa**. O Claude é particularmente eficaz quando o problema é mal-estruturado — quando você sabe o *objetivo* mas ainda está descobrindo a *forma*.

Casos de uso centrais:
- Definir ADRs (Architecture Decision Records): "por que SQLite e não Postgres?", "por que event sourcing e não balance column?"
- Raciocinar sobre failure modes ("o que acontece se o servidor reinicia no meio de uma transação?")
- Revisar invariantes de segurança antes de implementar

---

## O que a IA não fez

É importante ser preciso sobre os limites:

- **Não definiu o problema.** A percepção de que feiras escolares sofrem com caos de moedas físicas e que WiFi falha na hora errada — isso é observação humana, não inferência de máquina.

- **Não tomou decisões arquiteturais.** A escolha de local-first, event sourcing, SQLite WAL, WebSocket sobre polling — cada uma dessas tem raciocínio registrado nos [ADRs](../architecture/adr-001.md). A IA *executou* as implicações dessas decisões, não as escolheu.

- **Não revisou o próprio output.** Todo código gerado passou por revisão. A IA erra — especialmente em edge cases de concorrência, autenticação e condições de erro. A spec detalhada era exatamente o que tornava esses erros visíveis e corrigíveis.

- **Não garantiu coerência sistêmica.** Garantir que o backend nunca confie no frontend, que saldos nunca sejam armazenados diretamente, que eventos sejam imutáveis — isso exige uma visão do sistema que o agente não mantém entre sessões. Quem mantém sou eu.

---

## Eficiência: o que mudou

O ganho de produtividade não veio de "escrever código mais rápido". Veio de mudar o que *eu* precisava fazer.

Sem IA, o loop seria: pensar → pesquisar → codificar → debugar → refatorar.

Com IA, o loop virou: pensar → especificar → revisar → refinar spec.

O custo cognitivo de *especificar bem* é real — é mais trabalhoso do que parece. Mas é um trabalho de nível mais alto: você está fazendo engenharia, não programação. A distinção importa.

Em números aproximados: o que levaria semanas de trabalho solo foi entregue em dias — não porque o código foi gerado "de graça", mas porque o gargalo mudou de *implementação* para *design*, que é onde o esforço deveria estar desde o início.

---

## A dimensão filosófica

Existe uma tensão genuína aqui que merece ser nomeada.

Quando você lê o código deste projeto — os handlers de WebSocket, o algoritmo de rate limiting, a lógica de round-robin de distribuição — e pergunta "quem escreveu isso?", a resposta honesta é *ambígua*. O agente gerou as linhas. Eu defini o contrato que as linhas precisam satisfazer. Eu revisei, rejeitei versões que violavam invariantes, pedi iterações.

É autoria? Sim — da mesma forma que um arquiteto é o autor de um edifício que ele não ergueu tijolo por tijolo.

Mas existe uma armadilha: a facilidade de geração pode iludir a sensação de entendimento. Código que "funciona" não é código que você *compreende*. Parte do trabalho de revisão era deliberadamente lenta — ler linha a linha, questionar cada decisão, entender por que um `try-catch` estava ali e não em outro lugar. A IA acelera a geração; não acelera o entendimento. Esse é um trabalho que continua sendo humano.

O nome do projeto — **Ouroboros**, a serpente que morde a própria cauda — tem uma ressonância não intencional aqui. O processo de desenvolver com IA é cíclico: você alimenta specs, recebe código, o código informa as próximas specs, e o sistema cresce por retroalimentação. Não é linear. Não é um "você manda, a máquina faz". É um diálogo com um interlocutor que sabe executar mas não sabe querer.

---

## Para quem quiser replicar

Se você quer usar uma metodologia similar em seus projetos:

1. **Escreva a spec antes do código.** Descreva o comportamento esperado, os casos de borda, o que *não* deve acontecer. Quanto mais precisa a spec, melhor o output.

2. **Trate o agente como um colaborador, não um oráculo.** Questione o que ele gera. Peça alternativas. Explique por que uma solução não serve.

3. **Mantenha os invariantes na sua cabeça.** O agente não conhece o sistema todo. Você sim. Você é o guardião das restrições que não podem ser violadas.

4. **Documente as decisões, não só o código.** Os ADRs neste projeto existem precisamente porque a IA pode gerar uma implementação diferente amanhã — o que deve permanecer são os *porquês*, não os *comos*.

5. **Use o agente para o que ele é bom.** Implementação repetitiva, testes, documentação, refatoração mecânica. Reserve seu foco para design, trade-offs e revisão.

---

*Desenvolvido com [GitHub Copilot](https://github.com/features/copilot) e [Claude](https://claude.ai) — por [Caio Fiori Martins](https://github.com/fiorionrails).*
