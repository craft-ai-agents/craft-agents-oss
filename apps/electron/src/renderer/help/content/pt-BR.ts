import type { HelpContent } from '../types'
import type { InlineHelpFeature } from '../types'

export const ptBR: Record<InlineHelpFeature, HelpContent> = {
  sources: {
    title: 'Fontes',
    summary: 'Fontes conectam seu agente a dados e serviços externos.',
    sections: [
      {
        heading: 'O que são Fontes?',
        paragraphs: [
          'Fontes dão ao seu agente acesso a ferramentas e dados externos. Quando você conecta uma fonte, o agente pode usá-la durante conversas para ler, pesquisar e interagir com serviços.',
        ],
      },
      {
        heading: 'Tipos de Fontes',
        items: [
          'Servidores MCP — Integrações ricas para serviços como GitHub, Linear, Notion e mais. MCP (Model Context Protocol) fornece acesso estruturado com entradas e saídas tipadas.',
          'APIs REST — Conecte-se a qualquer API HTTP com autenticação flexível. Faça requisições GET, POST, PUT e DELETE para serviços externos.',
          'Pastas Locais — Dê ao seu agente acesso de leitura a diretórios na sua máquina, como vaults do Obsidian, repositórios de código ou pastas de dados.',
        ],
      },
      {
        heading: 'Como as Fontes Funcionam',
        paragraphs: [
          'Cada fonte fica no seu workspace em ~/.g4os/workspaces/{id}/sources/{slug}/. Contém um config.json com detalhes de conexão e um guide.md opcional que descreve como usar a fonte.',
          'O arquivo guide.md é injetado no contexto do agente, ensinando quando e como usar as ferramentas da fonte. Você pode personalizar este arquivo para ajustar o comportamento.',
        ],
      },
      {
        heading: 'Permissões',
        paragraphs: [
          'As fontes respeitam o modo de permissão da sessão. No modo Explorar, o agente só pode ler dados. No modo Pedir para Editar, ele pergunta antes de fazer alterações. No modo Executar, todas as operações são auto-aprovadas.',
          'Você também pode configurar permissões por fonte em um arquivo permissions.json junto com o config da fonte.',
        ],
      },
    ],
  },

  'sources-api': {
    title: 'Fontes de API',
    summary: 'Conecte-se a qualquer API REST com autenticação flexível.',
    sections: [
      {
        heading: 'O que são Fontes de API?',
        paragraphs: [
          'Fontes de API permitem que seu agente faça requisições HTTP para qualquer API REST. Configure a URL base, autenticação, e o agente pode chamar endpoints durante conversas.',
        ],
      },
      {
        heading: 'Configuração',
        paragraphs: [
          'Cada fonte de API precisa de uma URL base e opcionalmente um método de autenticação. A configuração é armazenada no arquivo config.json da fonte.',
        ],
      },
      {
        heading: 'Tipos de Autenticação',
        items: [
          'Bearer Token — Envia um cabeçalho Authorization com um token bearer.',
          'API Key — Envia um cabeçalho personalizado (ex: X-API-Key) com sua chave.',
          'Basic Auth — Autenticação HTTP Basic com usuário e senha.',
          'OAuth 2.0 — Fluxo de credenciais do cliente ou código de autorização.',
          'Nenhum — Nenhuma autenticação necessária.',
        ],
      },
      {
        heading: 'Endpoint de Teste',
        paragraphs: [
          'Você pode configurar um endpoint de teste para verificar se a conexão está funcionando. O app chamará este endpoint quando você adicionar a fonte e mostrará o status da conexão.',
        ],
      },
      {
        heading: 'MCP vs Fontes de API',
        paragraphs: [
          'Fontes MCP fornecem ferramentas estruturadas com entradas/saídas tipadas e são ideais para serviços conhecidos com servidores MCP existentes. Fontes de API são mais flexíveis e funcionam com qualquer API HTTP, mas requerem mais configuração.',
        ],
      },
    ],
  },

  'sources-mcp': {
    title: 'Servidores MCP',
    tabs: [
      {
        id: 'overview',
        label: 'Visão Geral',
        page: {
          title: 'Visão Geral do MCP',
          summary: 'Servidores MCP fornecem acesso estruturado a ferramentas.',
          sections: [
            {
              heading: 'O que é MCP?',
              paragraphs: [
                'MCP (Model Context Protocol) é um padrão aberto para conectar agentes de IA a ferramentas e fontes de dados externas. Servidores MCP expõem um conjunto de ferramentas que seu agente pode chamar durante conversas.',
              ],
            },
            {
              heading: 'Como o MCP Funciona',
              paragraphs: [
                'Quando você conecta um servidor MCP, o G4 OS descobre suas ferramentas disponíveis e as disponibiliza para o agente. Cada ferramenta tem um nome, descrição e esquema de entrada tipado que o agente usa para chamá-la corretamente.',
                'Servidores MCP podem rodar localmente (stdio) ou remotamente (SSE/HTTP). Servidores locais são iniciados como subprocessos; servidores remotos conectam pela rede.',
              ],
            },
            {
              heading: 'Servidores MCP Populares',
              items: [
                'GitHub — Issues, PRs, repositórios, busca de código',
                'Linear — Issues, projetos, equipes',
                'Notion — Páginas, bancos de dados, busca',
                'Slack — Mensagens, canais, usuários',
                'Filesystem — Leitura/escrita de arquivos com restrições de caminho',
                'PostgreSQL — Consultas ao banco de dados (somente leitura por padrão)',
              ],
            },
          ],
        },
      },
      {
        id: 'connecting',
        label: 'Conexão',
        page: {
          title: 'Conectando Servidores MCP',
          summary: 'Como adicionar e configurar conexões de servidores MCP.',
          sections: [
            {
              heading: 'Adicionando um Servidor MCP',
              paragraphs: [
                'Use o botão "Adicionar Fonte" na barra lateral ou clique em "+" no painel de Fontes. Selecione "Servidor MCP" e forneça os detalhes de conexão.',
              ],
            },
            {
              heading: 'Tipos de Conexão',
              items: [
                'stdio — Executa o servidor como um subprocesso local. Forneça o comando e argumentos (ex: npx @modelcontextprotocol/server-github).',
                'SSE — Conecta a um servidor remoto via Server-Sent Events. Forneça a URL do endpoint.',
                'HTTP Streamable — Conecta via streaming HTTP. Forneça a URL do endpoint.',
              ],
            },
            {
              heading: 'Variáveis de Ambiente',
              paragraphs: [
                'Muitos servidores MCP precisam de variáveis de ambiente para configuração (ex: GITHUB_TOKEN). Você pode definí-las no config da fonte e elas serão passadas para o subprocesso.',
              ],
            },
            {
              heading: 'guide.md',
              paragraphs: [
                'Cada fonte pode ter um arquivo guide.md que ensina o agente quando e como usar as ferramentas. Isso é injetado no prompt do sistema. Você pode personalizá-lo para adicionar exemplos de uso ou restringir quais ferramentas o agente deve preferir.',
              ],
            },
          ],
        },
      },
      {
        id: 'auth',
        label: 'Autenticação',
        page: {
          title: 'Autenticação MCP',
          summary: 'Configurando autenticação para servidores MCP.',
          sections: [
            {
              heading: 'Autenticação por Variáveis de Ambiente',
              paragraphs: [
                'A maioria dos servidores MCP usa variáveis de ambiente para autenticação. Defina tokens como GITHUB_TOKEN, LINEAR_API_KEY, etc. na configuração de ambiente da fonte. Eles são armazenados de forma segura no arquivo de credenciais criptografado.',
              ],
            },
            {
              heading: 'Autenticação OAuth',
              paragraphs: [
                'Alguns servidores MCP suportam OAuth para autenticação. O G4 OS pode gerenciar o fluxo OAuth — quando o agente aciona a autenticação, uma janela do navegador abre para você autorizar o acesso. Os tokens são armazenados de forma segura e renovados automaticamente.',
              ],
            },
            {
              heading: 'Armazenamento de Credenciais',
              paragraphs: [
                'Todas as credenciais são armazenadas em ~/.g4os/credentials.enc, criptografadas com AES-256-GCM. Nunca são armazenadas em texto simples ou commitadas no controle de versão.',
              ],
            },
          ],
        },
      },
    ],
  },

  'sources-local': {
    title: 'Pastas Locais',
    summary: 'Dê ao seu agente acesso a diretórios locais na sua máquina.',
    sections: [
      {
        heading: 'O que são Fontes de Pasta Local?',
        paragraphs: [
          'Fontes de pasta local dão ao seu agente acesso de leitura a diretórios na sua máquina. Útil para bases de conhecimento como vaults do Obsidian, pastas de documentação ou diretórios de dados.',
        ],
      },
      {
        heading: 'Configuração',
        paragraphs: [
          'Ao adicionar uma fonte de pasta local, selecione o diretório que deseja compartilhar. O agente poderá ler arquivos dentro desse diretório e seus subdiretórios.',
        ],
      },
      {
        heading: 'guide.md',
        paragraphs: [
          'Você pode criar um arquivo guide.md na pasta da fonte para descrever seu conteúdo e ensinar o agente a navegar nos arquivos. Por exemplo, explique a estrutura de pastas ou destaque arquivos importantes.',
        ],
      },
      {
        heading: 'Permissões',
        paragraphs: [
          'Fontes de pasta local são somente leitura por padrão. O agente pode pesquisar e ler arquivos, mas não pode modificá-los. Você pode configurar acesso de escrita adicionando allowedWritePaths no permissions.json da fonte.',
        ],
      },
      {
        heading: 'Pastas Locais vs Diretório de Trabalho',
        paragraphs: [
          'O diretório de trabalho é a pasta onde o agente executa comandos (como um terminal). Fontes de pasta local são diferentes — fornecem acesso estruturado a arquivos sem executar comandos. Isso as torna mais seguras para acesso a bases de conhecimento.',
        ],
      },
    ],
  },

  skills: {
    title: 'Skills',
    summary: 'Conjuntos de instruções reutilizáveis que ensinam comportamentos especializados ao seu agente.',
    sections: [
      {
        heading: 'O que são Skills?',
        paragraphs: [
          'Skills são instruções reutilizáveis que ensinam comportamentos especializados ao seu agente. Cada skill é definida por um arquivo SKILL.md que contém um fragmento de prompt do sistema — instruções, exemplos e diretrizes para uma tarefa específica.',
        ],
      },
      {
        heading: 'Criando uma Skill',
        paragraphs: [
          'Crie uma skill adicionando uma pasta em ~/.g4os/workspaces/{id}/skills/{slug}/ com um arquivo SKILL.md. O arquivo deve conter instruções claras para o comportamento desejado.',
        ],
        items: [
          'Dê um nome e descrição descritivos no cabeçalho de metadados.',
          'Escreva instruções claras e específicas no corpo.',
          'Inclua exemplos de entrada/saída esperados quando útil.',
          'Mantenha as instruções focadas em uma única tarefa ou domínio.',
        ],
      },
      {
        heading: 'Invocando Skills',
        paragraphs: [
          'Invoque uma skill @mencionando seu nome na sua mensagem. As instruções da skill são injetadas no contexto do agente para aquele turno, guiando seu comportamento.',
          'Você também pode configurar skills para ativação automática em todas as mensagens de uma sessão, útil para comportamentos persistentes como guias de estilo de código.',
        ],
      },
      {
        heading: 'Metadados da Skill',
        paragraphs: [
          'Skills suportam um cabeçalho YAML frontmatter com metadados como nome, descrição, ícone e regras de ativação. A descrição ajuda o agente a entender quando sugerir o uso da skill.',
        ],
      },
    ],
  },
}
