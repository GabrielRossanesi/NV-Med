# Diretrizes de UI/UX do NV Med

## Conteúdo e hierarquia

- Dê a cada página um título claro. Use subtítulos e textos de apoio quando acrescentarem contexto necessário, como o período de uma métrica, o alcance de um filtro ou a consequência de uma ação.
- Retire títulos repetidos, descrições que narram o controle ao lado, selos sem estado real e ícones que apenas duplicam o rótulo. Mantenha rótulos de campos, unidades, datas, instruções de recuperação e avisos que mudam uma decisão operacional.
- Posicione a ação principal, as pendências acionáveis e os indicadores relevantes no início da página. Use cor e destaque conforme o estado real. Dê menos peso visual a contagens zeradas e informações de apoio.
- Use os termos adotados no sistema. Especifique a ação ou o estado em português claro, como “Aguardando confirmação” e “Vaga aberta”.

## Filtros, tabelas e indicadores

- Agrupe os filtros compartilhados antes das áreas afetadas. Coloque os controles próprios de período ou de exibição perto dos resultados. Identifique filtros ativos mesmo quando o grupo estiver recolhido.
- Preserve o recorte e o significado dos dados ao reorganizar a exibição. Mantenha juntos o valor, a unidade e o rótulo de cada indicador. Diferencie uma contagem zerada, dados indisponíveis e carregamento.
- Use cabeçalhos de tabela semânticos e estados vazios que indiquem o recorte atual. Em grades densas, limite a rolagem horizontal à região da tabela e permita que ela receba foco pelo teclado. Preserve informações operacionais como o nome do médico, horário e situação da vaga.

## Formulários e diálogos

- Mantenha a ordem dos campos consistente entre cadastro e edição. Agrupe campos por tarefa, use rótulos visíveis e indique restrições que afetem o preenchimento. Use exemplos de formato quando forem úteis.
- Prefira um formulário contínuo quando o trabalho for rápido e sequencial. Recolha informações secundárias quando isso reduzir a carga visual sem esconder campos obrigatórios, avisos ou erros de validação.
- Reutilize o componente `Dialog`. Dê título acessível ao diálogo, mantenha a ação principal ao alcance em formulários longos e permita rolar os campos quando o teclado reduzir a área visível. Ao fechar, devolva o foco ao controle de origem quando ele ainda estiver disponível.
- Preserve os valores digitados após erros. Mostre feedback próximo do campo ou da ação que o usuário deve corrigir. Para preenchimento assistido, mantenha uma entrada manual e descarte respostas atrasadas de consultas substituídas.

## Visualização das escalas

- No calendário mensal, mantenha unidade, setores, modo de visualização e navegação de período antes da grade. Posicione filtros avançados e o resumo de cobertura abaixo, recolhidos por padrão. Mostre perto da grade quando houver filtros ativos, ofereça uma ação para limpá-los e dê acesso direto aos alertas críticos.
- Abra a ficha pelo identificador do plantão, da vaga ou do posto já criado. Reserve o botão do dia para consultar o conjunto de plantões. Postos previstos que ainda não foram criados levam aos detalhes do turno.
- Use os tokens de escala para distinguir plantões diurnos em verde claro e noturnos em verde escuro. Mantenha as vagas abertas em vermelho e os postos sem médico em tom neutro. Identifique o período com sol ou lua e um nome acessível. No mês, limite nomes a duas linhas com tooltip para o nome completo e mantenha o horário visível.
- Mantenha unidade, setor, período, data, médico e horários da alocação na parte principal da ficha. Mostre a especialidade derivada e o horário previsto como informação compacta. Recolha dados operacionais, financeiros, candidaturas e aprovações, conforme a permissão. Coloque o histórico no cabeçalho e cancelar e salvar no rodapé. Solicite justificativa quando a alteração retroativa exigir auditoria.
- Mantenha o painel de cobertura na mesma ficha, ao lado no desktop e abaixo em telas menores. A barra é proporcional aos minutos. Cada segmento e seu item de lista abrem o mesmo editor, com nome, horários, foco visível e seleção indicada. A lista oferece alvos de toque de 44 px inclusive para trechos curtos.
- Preencha os horários do editor com o trecho escolhido. Em **Adicionar médico**, sugira uma vaga ou ofereça dividir ou substituir uma alocação. A divisão preserva o primeiro médico e aceita uma vaga como segundo trecho. Mantenha a capacidade contratada e o período previsto em Dados operacionais.
- **Aplicar alteração** atualiza o rascunho da ficha, a barra, os totais e a lista. **Salvar plantão** grava o conjunto de uma vez. Ao fechar com rascunho, use a confirmação padrão. Reavalie a elegibilidade ao mudar o intervalo e mantenha os avisos documentais separados dos bloqueios.
- Mostre cada vaga gerada como um item vermelho e clicável na Escala Geral, com horário exato e duração quando houver espaço. Preserve a data operacional do posto e ordene seus trechos pelo horário efetivo, inclusive depois da meia-noite. Indique a publicação no Portal Médico na ficha, junto à ação disponível para o perfil.

## Responsividade e acessibilidade

- Confira pelo menos 1440, 390 e 360 px nas alterações de layout. Verifique conteúdo longo, filtros, menus, diálogos, rolagem, foco e campos com a área visível reduzida pelo teclado.
- Use a ordem natural de navegação. Garanta foco visível, alvos de toque adequados e operação por teclado. Dê nomes acessíveis aos botões de ícone e preserve rótulos ao simplificar a interface.
- Combine cor com texto ou ícone identificável para distinguir estados. Anuncie carregamento, erro e sucesso quando o feedback for assíncrono.

## Notificações de ações

### Padrão permanente de confirmação e toast

- Use `ConfirmationDialog` para confirmações controladas por um componente e `useConfirmation()` de `ConfirmationProvider` para decisões disparadas por ações. Ambos reutilizam `Dialog`; não implemente outro overlay, portal ou serviço de toast em uma página.
- O modal de confirmação é compacto (`size="sm"`), com bordas arredondadas, ícone contextual sobre fundo circular suave, título destacado e descrição objetiva. Use texto que explique o efeito e os dados preservados quando isso mudar a decisão.
- Sempre ofereça cancelamento secundário e confirmação com o verbo da ação: “Ativar cadastro”, “Excluir médico”, “Adicionar checklist”. A confirmação usa verde; ações destrutivas usam vermelho. O ícone pode usar sucesso, perigo, atenção ou informação conforme o contexto. Use os tokens semânticos existentes, que atendem aos temas claro e escuro.
- Passe a gravação assíncrona em `onConfirm` e devolva seu resultado. O modal só fecha após sucesso; `false` mantém o modal disponível para correção ou nova tentativa. Durante a gravação, mantenha spinner, `aria-busy`, proteção contra clique duplicado e bloqueio de fechamento. Cancelar não deve chamar o backend nem gerar um toast.
- Para confirmações com formulário ou análise extensa já existentes, use `Dialog variant="confirmation" confirmationTone="danger|success|warning|info"`. Preserve os campos, a validação e as regras de negócio. `DeleteConfirmDialog` mantém a confirmação por texto, usando o mesmo componente visual.
- Os toasts continuam em `Notifications`, enviados exclusivamente por `notify`. Use ícone semântico, título curto, descrição breve quando houver recuperação a orientar e botão acessível de fechamento. O fundo circular do ícone, as cores e os estados usam os mesmos tokens dos modais.
- Preserve as animações discretas: entrada de 160 ms, saída de 120 ms nas confirmações do provider e transições de 180 ms nos toasts. Respeite `prefers-reduced-motion`. Não acrescente saltos, escalas decorativas ou efeitos de brilho.
- Mantenha foco visível, devolução do foco ao controle de origem, cancelamento por Escape quando o modal não estiver ocupado e ausência de rolagem horizontal em 1440, 390 e 360 px.
- Não use `window.confirm`, `window.alert`, `window.prompt` nem suas formas globais para decisões ou feedback da aplicação. A regra ESLint `no-alert` impede sua reintrodução em `src`. A proteção `beforeunload` de alterações não salvas é a exceção: o navegador controla o aviso ao fechar ou recarregar a aba e não permite substituí-lo por um modal assíncrono. A navegação dentro da aplicação e o logout usam o modal próprio.
- Mensagens de backend nunca entram diretamente em um toast. Mapeie erros técnicos para mensagens públicas conhecidas; registre somente metadados de diagnóstico sem dados médicos ou credenciais. Erros de status cadastral usam `doctorStatusError`.

Exemplo de uso com gravação:

```tsx
const confirm = useConfirmation();
await confirm({
  title: 'Ativar cadastro do médico?',
  description: 'Os plantões e documentos serão preservados. O acesso ao portal continua independente.',
  confirmLabel: 'Ativar cadastro',
  tone: 'success',
  onConfirm: () => useStore.getState().setDoctorStatus(doctor.id, 'active'),
});
```

- Use `notify` de `src/lib/notifications.ts` para confirmar ações relevantes depois que o servidor responder. Escolha sucesso para a conclusão, informação para um próximo estado, atenção para um cuidado necessário e erro para uma falha sem feedback adequado na tela.
- Use títulos curtos e inclua uma descrição quando ela explicar o resultado ou orientar a recuperação. Mantenha validações e falhas de formulário perto da ação e preserve o que foi digitado. Mantenha confirmações, avisos operacionais e resumos que precisem ficar na tela.
- Evite Toasts ao navegar, filtrar ou abrir uma área. Evite repetir a mesma mensagem como Toast e como aviso inline. Use `persistent` para erros que exigem leitura ou ação antes de continuar.
- Use `withinDialog` para confirmações exibidas em um diálogo que permanece aberto. Por padrão, erros globais usam o diálogo ativo e confirmações usam a página.
- Posicione os Toasts no canto inferior direito em desktop e acima da navegação inferior no mobile. Use `notify.saving()` enquanto uma gravação estiver em andamento e encerre o Toast no `finally`.

## Identidade visual e auditoria

- Reutilize componentes, classes `nv-*` e tokens existentes de cor, tipografia, espaçamento e estados. Mantenha padrões de navegação e interação reconhecíveis entre módulos.
- Use a skill [`unslop-ui`](https://github.com/felipebasurto/unslop-ui) para localizar candidatos à limpeza. Revise cada caso em contexto, mantenha informações operacionais e use `--surface` apenas quando o escopo incluir ajustes visuais. Trate a contagem como diagnóstico, pois ela também sinaliza estados e elementos legítimos.
- Confira o diff em busca de mudanças acidentais em permissões, cálculos, consultas e ações. Valide o fluxo no navegador e execute os testes, lint e build disponíveis para o escopo.
