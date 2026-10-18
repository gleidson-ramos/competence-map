# Observatório de Dados Públicos Abertos: Um experimento aplicado ao contexto Universidade-Empresa
<p align="center">
  Recuperação semântica de competências acadêmicas para apoio à colaboração entre Universidade e Empresa.
  <br>
  <a href="https://github.com/gleidson-ramos/TCC-competence-semantic">
    Repositório
  </a>
  •
  <a href="https://saberaberto.uneb.br/items/935d4371-77b2-4b20-8672-144f5bcfc633">
    Trabalho Completo
  </a>
</p>

## 📚 Sobre o projeto
Este repositório contém o código-fonte desenvolvido como parte do Trabalho de Conclusão de Curso **"Observatório de Dados Públicos Abertos: Um experimento aplicado ao contexto Universidade-Empresa"**.

O projeto faz o uso de técnicas de **Processamento de Linguagem Natural (PLN)**, **embeddings**, **classificação taxonômica** e **recuperação de informação** para apoiar a identificação de competências científicas e áreas de conhecimento relacionadas a:
- 👨‍🔬 Pesquisadores;
- 🏢 Empresas;
- 👥 Grupos de Pesquisa.

O projeto busca superar limitações de mecanismos tradicionais baseados exclusivamente na correspondência lexical entre termos de consulta e dados cadastrados. E, ao invés de depender apenas da ocorrência exata de uma palavra-chave, o sistema utiliza representações vetoriais para identificar relações de significado entre a consulta e as informações disponíveis nos perfis das entidades.

## 🎯 Objetivo
Desenvolver e avaliar um mecanismo de recuperação de informação capaz de identificar, de forma **semântica e contextual**, competências acadêmicas relacionadas às necessidades de colaboração entre universidades e empresas.

O sistema combina diferentes estratégias de processamento para:
1. Obter informações de perfis acadêmicos e institucionais;
2. Extrair e representar informações textuais dos perfis por meio de embeddings semânticos;
3. Identificar e classificar as competências científicas dos perfis segundo uma taxonomia de áreas do conhecimento;
4. Indexar as informações em uma estrutura vetorial;
5. Recuperar entidades semanticamente relacionadas a uma consulta;
6. Comparar a recuperação semântica com abordagens lexicais e híbridas.

## 🧠 Abordagem

O processamento do sistema pode ser representado de forma simplificada pelo seguinte fluxo:

```text
                 Dados dos Perfis
                       │
                       ▼
              Processamento Textual
                       │
                       ▼
             Classificação Taxonômica
                       │
                       ▼
       Geração das Competências Científicas
                       │
                       ▼
                   Embeddings
                       │
                       ▼
               Indexação Vetorial
                       │
                       ▼
                Consulta do Usuário
                       │
                       ▼
             Busca por Similaridade
                       │
                       ▼
              Resultados Relevantes
```

## 🔎 Recuperação semântica
A `recuperação de informação` utiliza **embeddings**, que transformam textos em vetores numéricos capazes de representar características semânticas.
Dessa forma, consultas e documentos semanticamente relacionados podem apresentar elevada similaridade vetorial mesmo quando não compartilham exatamente os mesmos termos.

### Exemplo

Uma consulta como:

```text
Inteligência Artificial
```

pode recuperar um perfil que descreva atividades relacionadas a:

```bash
- desenvolvimento de sistemas inteligentes
- processamento de linguagem natual
- aprendizado de máquina
- robótica industrial
```

mesmo que a expressão pesquisada não apareça literalmente no texto do perfil.

Essa característica é especialmente relevante no contexto Universidade-Empresa, no qual uma empresa pode descrever uma necessidade utilizando uma terminologia diferente daquela empregada por um pesquisador ou grupo acadêmico.

---

## 🗂️ Entidades processadas

O sistema trabalha com três tipos de entidades:

| Entidade | Descrição |
|---|---|
| **Pesquisador** | Perfil acadêmico contendo informações sobre formação, atuação, projetos, produção e competências |
| **Grupo de Pesquisa** | Grupo acadêmico associado a áreas e linhas de pesquisa |
| **Empresa** | Organização que podem apresentar segmento, missão, visão, valores e descrição |

As entidades são processadas com base em seus respectivos perfis, a fim de identificar, gerar e/ou atualizar suas áreas de competência.

Após o processamento, as áreas de competência resultantes são persistidas e disponibilizadas para recuperação e consulta pelo sistema. Dessa forma, as informações permanecem estruturadas e atualizadas, permitindo sua utilização no processos de busca.


## 🧬 Classificação taxonômica
Uma etapa importante do sistema é a classificação das informações dos perfis segundo uma **taxonomia de áreas do conhecimento**.

O processo considera a quantidade de informações disponíveis no perfil para determinar a quantidade de candidatos e classificações a serem processados. A classificação permite enriquecer os dados originais do perfil, gerando uma representação mais adequada para a recuperação semântica.

De forma geral o precesso pode ser representado da seguinte maneira:
```text
       Perfil da Entidade
              │
              ▼
Análise da riqueza informacional
              │
              ▼
     Seleção de candidatos
              │
              ▼
   Classificação taxonômica
              │
              ▼
Identificação das Competências
```


## ⚡ Indexação incremental

O sistema também utiliza uma estratégia de processamento incremental.
Em vez de reprocessar todos os registros a cada execução, o sistema verifica alterações na entidade armazenada em cache.

```text
                 Entidade
                    │
                    ▼
           Verificar atualização
                    │
          ┌─────────┴──────────┐
          │                    │
       Alterada            Inalterada
          │                    │
          ▼                    ▼
      Reprocessar            Ignorar
          │
          ▼
    Atualizar cache
          │
          ▼
   Atualizar índice
```

Essa abordagem reduz processamento desnecessário e permite que apenas registros novos ou modificados sejam submetidos novamente às etapas de classificação e indexação.

## 🏗️ Estrutura do projeto

A estrutura atual do repositório está organizada da seguinte forma:

```text
TCC-competence-semantic/
│
├── prompts/
│   └── Prompts utilizados no processamento/classificação
│
├── static/
│   └── Recursos estáticos da aplicação
│
├── templates/
│   └── Templates da interface web
│
├── utils/
│   └── Funções e componentes auxiliares
│
├── app.py
│   └── Aplicação principal
│
├── classifier.py
│   └── Lógica de classificação
│
├── companies.py
│   └── Processamento de empresas
│
├── config.py
│   └── Configurações da aplicação
│
├── groups.py
│   └── Processamento de grupos de pesquisa
│
├── researcher.py
│   └── Processamento de pesquisadores
│
├── taxonomy.py
│   └── Estrutura e processamento da taxonomia
│
└── .gitignore
```

## 🛠️ Tecnologias
O protótipo foi desenvolvido utilizando:
- **Python** para o desenvolvimento do sistema.
- **Flask** para a construção da API.
- **LangChain** para integração e orquestração dos componentes de IA.
- **PostgreSQL** para armazenamento e gerenciamento dos dados.
- **PGVector** para armazenamento e recuperação de representações vetoriais.
- ***Embeddings*** para representação semântica dos dados.
- **OpenAI** para processamento e classificação das informações.
- **Processamento de Linguagem Natural** para análise e interpretação dos dados textuais.
- **HTML, CSS e JavaScript** para a construção da interface da aplicação.

O projeto utiliza armazenamento vetorial integrado ao PostgreSQL para possibilitar a persistência e recuperação das representações vetoriais.

## 🧮 Estratégias de recuperação

O usuário do sistema pode escolher entre diferentes estratégias de recuperação:

### Busca lexical
Baseada na correspondência entre os termos da consulta e os termos presentes nos documentos.

### Busca semântica
Utiliza embeddings e similaridade vetorial para identificar documentos semanticamente relacionados à consulta.

### Busca híbrida
Combina informações provenientes da recuperação lexical e semântica para produzir uma classificação final dos resultados.

Essa comparação permite investigar em que medida a representação semântica consegue recuperar informações relevantes que poderiam não ser encontradas por uma busca baseada apenas em palavras-chave.

---

## 📊 Avaliação

O sistema foi avaliado utilizando consultas relacionadas a diferentes áreas de conhecimento, podendo ser vista em detalhes no Capítulo 7 do trabalho.

As principais métricas utilizadas foram:
### Mean Reciprocal Rank (MRR)
- Avalia a posição do primeiro resultado considerado relevante em cada consulta.
- Quanto mais próximo de `1`, melhor a posição dos primeiros resultados relevantes.

### Precision@K
Avalia a proporção de resultados relevantes entre os ``K`` primeiros resultados retornados pelo sistema.

```text
Precision@5 =   quantidade de resultados relevantes nos K primeiros
                ----------------------------------------------------
                                         K
```

Os resultados completos e a metodologia de avaliação estão apresentados no trabalho acadêmico.

## 📖 Trabalho Acadêmico
O código deste repositório está associado ao Trabalho de Conclusão de Curso disponível no repositório institucional da Universidade do Estado da Bahia (UNEB).

**Título:** <a href="https://saberaberto.uneb.br/items/935d4371-77b2-4b20-8672-144f5bcfc633">Observatório de Dados Públicos Abertos: Um experimento aplicado ao contexto Universidade-Empresa</a>

O trabalho apresenta a fundamentação teórica, metodologia, arquitetura do sistema, processo de classificação, recuperação de informação e avaliação experimental.

## 🚀 Execução

### 1. Clonar o repositório

```bash
git clone https://github.com/gleidson-ramos/TCC-competence-semantic.git
cd TCC-competence-semantic
```

### 2. Criar um ambiente virtual
```bash
python -m venv venv
```

### 3. Ativar o ambiente virtual
#### Windows
```bash
venv\Scripts\activate
```

#### Linux / macOS
```bash
source venv/bin/activate
```

### 4. Instalar as dependências
```bash
pip install -r utils/requirements.txt
```

### 5. Configurar as variáveis de ambiente
Configure as credenciais e parâmetros necessários para conexão com os serviços utilizados pelo sistema. O `config.py` deve conter as seguintes informações:
```bash
import os

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "chave_da_API")

DB_CONN_RAW = "postgresql://<usuario>:<senha>@<host>:<porta>/<banco>"
DB_CONN_VECTOR = "postgresql+psycopg://<usuario>:<senha>@<host>:<porta>/<banco>"
```

### 6. Gerar as classificações das Áreas Científicas

Classificações das empresas: 
```bash
python companies.py
```

Classificações dos grupos de pesquisa:
```bash
python groups.py
```

Classificações dos pesquisadores:
```bash
python researcher.py
```

### 7. Executar a aplicação
```bash
python app.py
```

Após iniciar a aplicação, acesse o endereço disponibilizado pelo servidor Flask.


## 📁 Dados
O projeto foi desenvolvido como um **experimento acadêmico**. O objetivo principal do protótipo é demonstrar e avaliar a aplicação das técnicas de classificação e recuperação semântica no contexto de colaboração Universidade-Empresa.
Parte das informações utilizadas foram de perfis disponíveis no Currículo Lattes e as informações empresarias foram informações fictícias geradas através de inteligência artificial.


## 🔬 Contribuições
O projeto apresenta contribuições em três dimensões principais:

### Técnica
Desenvolvimento de um mecanismo de recuperação que combina:
- Classificação taxonômica;
- Embeddings;
- Busca vetorial;
- Recuperação lexical;
- Recuperação semântica;
- Estratégia híbrida;
- Processamento incremental.

### Científica
Investigação experimental da aplicação de técnicas de recuperação semântica na identificação de competências acadêmicas relacionadas a demandas e áreas de interesse.

### Socioeconômica
Exploração de uma abordagem tecnológica capaz de facilitar a aproximação entre competências existentes no ambiente acadêmico e necessidades apresentadas pelo setor produtivo.



## 👨‍💻 Status do projeto
O sistema foi desenvolvido para fins de pesquisa e experimentação no contexto do Trabalho de Conclusão de Curso.

Os resultados obtidos demonstraram a viabilidade da abordagem proposta, evidenciando seu potencial para aplicação no contexto estudado. Entretanto, o projeto ainda possui oportunidades de aprimoramento, incluindo melhorias nos processos, ajustes nos modelos e avaliações adicionais, especialmente de natureza qualitativa, que permitam analisar de forma mais abrangente a qualidade, a relevância e a adequação dos resultados produzidos.