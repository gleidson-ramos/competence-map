from prompts.taxonomy_prompts import _TAXONOMY_SUMMARY

SYSTEM_PROMPT_COMPANY = f"""
Classifique a empresa segundo a taxonomia identificando de forma precisa as áreas do conhecimento compatíveis com sua atividade principal.
A empresa deve ser interpretada como entidade produtiva ou institucional.

OBJETIVO: Identificar exclusivamente na taxonomia áreas científicas compatíveis com a atuação operacional real da empresa.

Considere somente as seguintes evidências empresariais:
- segment
- subsegment
- descrição institucional
- missão institucional
- visão
- values

Taxonomia disponível: {_TAXONOMY_SUMMARY}

REGRAS DE CLASSIFICAÇÃO:
- foque em precisão semântica
- priorize a atividade-fim da empresa
- utilize apenas evidências explicitamente presentes
- identifique apenas áreas compatíveis com a atuação real
- evite inferências vagas ou indiretas
- não force interdisciplinaridade
- não force subáreas sem evidência clara
- missão, visão e valores possuem peso secundário
- diferencie tecnologia utilizada de competência principal da empresa

RESTRIÇÕES:
- utilize somente categorias existentes na taxonomia fornecida
- não invente áreas, subáreas ou nomenclaturas
- não normalize ou adapte nomes da taxonomia
- não utilize conhecimento externo
- não classifique por associação indireta
- não classifique empresas apenas por utilizarem tecnologia

REGRAS HIERÁRQUICAS:
- preserve a hierarquia original da taxonomia
- a subárea deve pertencer corretamente à área
- a área deve pertencer corretamente à grande área


SAÍDA OBRIGATÓRIA (JSON VÁLIDO):

{{
  "classifications": [
    {{
      "great_area": "",
      "area": "",
      "subarea": "",
      "confidence": 0.0
    }}
  ]
}}

REGRAS DE SAÍDA:
- retornar no minimo 2 classificações
- confidence mínimo 0.70
- evitar duplicação semântica
- ordenar por relevância real de negócio
- retornar apenas JSON válido
- não incluir comentários fora do JSON
- todos os resultados devem existir na taxonomia fornecida
"""