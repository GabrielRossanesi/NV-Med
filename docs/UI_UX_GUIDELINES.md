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

## Responsividade e acessibilidade

- Confira pelo menos 1440, 390 e 360 px nas alterações de layout. Verifique conteúdo longo, filtros, menus, diálogos, rolagem, foco e campos com a área visível reduzida pelo teclado.
- Use a ordem natural de navegação. Garanta foco visível, alvos de toque adequados e operação por teclado. Dê nomes acessíveis aos botões de ícone e preserve rótulos ao simplificar a interface.
- Combine cor com texto ou ícone identificável para distinguir estados. Anuncie carregamento, erro e sucesso quando o feedback for assíncrono.

## Notificações de ações

- Use `notify` de `src/lib/notifications.ts` para confirmar ações relevantes depois que o servidor responder. Escolha sucesso para a conclusão, informação para um próximo estado, atenção para um cuidado necessário e erro para uma falha sem feedback adequado na tela.
- Use títulos curtos e inclua uma descrição quando ela explicar o resultado ou orientar a recuperação. Mantenha validações e falhas de formulário perto da ação e preserve o que foi digitado. Mantenha confirmações, avisos operacionais e resumos que precisem ficar na tela.
- Evite Toasts ao navegar, filtrar ou abrir uma área. Evite repetir a mesma mensagem como Toast e como aviso inline. Use `persistent` para erros que exigem leitura ou ação antes de continuar.
- Use `withinDialog` para confirmações exibidas em um diálogo que permanece aberto. Por padrão, erros globais usam o diálogo ativo e confirmações usam a página.
- Posicione os Toasts no canto inferior direito em desktop e acima da navegação inferior no mobile. Use `notify.saving()` enquanto uma gravação estiver em andamento e encerre o Toast no `finally`.

## Identidade visual e auditoria

- Reutilize componentes, classes `nv-*` e tokens existentes de cor, tipografia, espaçamento e estados. Mantenha padrões de navegação e interação reconhecíveis entre módulos.
- Use a skill [`unslop-ui`](https://github.com/felipebasurto/unslop-ui) para localizar candidatos à limpeza. Revise cada caso em contexto, mantenha informações operacionais e use `--surface` apenas quando o escopo incluir ajustes visuais. Trate a contagem como diagnóstico, pois ela também sinaliza estados e elementos legítimos.
- Confira o diff em busca de mudanças acidentais em permissões, cálculos, consultas e ações. Valide o fluxo no navegador e execute os testes, lint e build disponíveis para o escopo.
