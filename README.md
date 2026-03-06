# ⚔️ Tormenta20 Attack Automation

Módulo para Foundry VTT que automatiza ações de combate para o sistema **Tormenta20**, similar ao que o MidiQOL faz para D&D 5e.

---

## 🚀 Funcionalidades

### Automação de Ataques
- ✅ Detecção automática de **acerto / erro / crítico / erro natural**
- ✅ Confirmação de crítico (rolagem extra vs. Defesa)
- ✅ Verificação da **Defesa** do alvo selecionado
- ✅ Card visual de ataque no chat com resultados por alvo

### Automação de Dano
- ✅ Rolagem automática de dano ao acertar
- ✅ **Multiplicador de crítico** configurável (padrão: ×2)
- ✅ Aplicação automática, manual ou com confirmação
- ✅ Suporte a **Redução de Dano (RD)**, imunidades e resistências
- ✅ Botões de "Aplicar Dano" e "Metade (Resistência)" no chat
- ✅ Dados coloridos (verde = máximo, cinza = 1)

### Automação de Condições
- ✅ Todas as **22 condições do Tormenta20** implementadas
- ✅ Aplicação via Active Effects com penalidades automáticas
- ✅ **Dano de sangramento** automático no início do turno
- ✅ Salvamentos vs. condição com CD
- ✅ Notificações no chat ao aplicar condições

### Interface
- ✅ Painel de controle rápido
- ✅ Menu de contexto nos tokens (botão direito)
- ✅ **HUD rápido** de dano/cura no token
- ✅ Dialog de condições com busca
- ✅ Suporte a socket (jogadores sem GM podem solicitar dano)

---

## 📦 Instalação

### Método 1: Instalação Manual
1. Baixe ou clone este repositório
2. Copie a pasta `t20-attack-automation` para `[seu-foundry]/Data/modules/`
3. No Foundry VTT, vá em **Configurações → Módulos** e ative **Tormenta20 Attack Automation**
4. Recarregue a página

### Método 2: Via URL do Manifesto
No Foundry VTT → **Instalar Módulo** → Cole a URL do `module.json`:
```
https://github.com/SEU-USUARIO/t20-attack-automation/raw/main/module.json
```

---

## ⚙️ Configuração

Acesse **Configurações do Mundo → Configurações do Módulo → Tormenta20 Attack Automation**:

| Configuração | Descrição | Padrão |
|---|---|---|
| Automatizar Ataques | Detecta acerto/erro/crítico automaticamente | ✅ Ativado |
| Automatizar Dano | Rola dano ao acertar | ✅ Ativado |
| Automatizar Condições | Aplica efeitos das condições | ✅ Ativado |
| Aplicação de Dano | none / ask / auto | ask |
| Multiplicador de Crítico | ×2, ×3 ou ×4 | ×2 |
| Exigir Alvo | Bloqueia ataque sem alvo | ❌ |
| Mostrar Defesa do Alvo | Nunca / Só GM / Todos | Só GM |

---

## 🎲 Uso

### Atacando
1. Selecione seu token
2. Selecione o alvo (tecla `T` ou clicando com `Alt`)
3. Use o item/arma normalmente pelo sistema T20
4. O módulo detecta o resultado e processa dano automaticamente

### Condições
**Via menu de contexto do token:**
- Botão direito no token → **Aplicar Condição**

**Via macro:**
```javascript
// Aplicar condição
const { T20ConditionAutomation } = game.modules.get("t20-attack-automation").api;
await T20ConditionAutomation.applyCondition(actor, "abalado");

// Salvamento vs. condição (CD 15, Vontade)
await T20ConditionAutomation.rollSaveVsCondition(actor, "apavorado", 15, "von");
```

### Dano Manual
**Via menu de contexto:** Botão direito → **Aplicar Dano Manualmente**

**Via macro:**
```javascript
const { T20DamageAutomation } = game.modules.get("t20-attack-automation").api;
await T20DamageAutomation._applyDamageToTarget(actor, 15, "fogo", null);
```

---

## 🗺️ Condições Implementadas

| Condição | Efeito Mecânico |
|---|---|
| Abalado | -2 em testes |
| Apavorado | Não pode se aproximar, -2 em testes |
| Agarrado | Preso, -2 em Ataque e Defesa |
| Atordoado | Perde ação, -5 em Defesa |
| Caído | -5 em Ataque e Defesa |
| Cego | -5 em Ataque, oponentes +5 para acertar |
| Desprevenido | -5 em Defesa |
| Enjoado | -2 em Ataque, Defesa e testes |
| Exausto | -5 em For/Des, velocidade ×0.5 |
| Inconsciente | Indefeso, -5 em Defesa, Caído |
| Lento | Velocidade ×0.5, -2 em Defesa |
| Sangrando | Perde 1d6 PV/turno |
| Vulnerável | -5 em Defesa |
| ...e mais 9 condições | |

---

## 🔧 Compatibilidade

- **Foundry VTT:** v11 e v12
- **Sistema:** tormenta20 (qualquer versão recente)
- **Outros módulos:** Compatível com Dice So Nice, PopOut, etc.

---

## ⚠️ Notas de Desenvolvimento

Este módulo foi desenvolvido usando as estruturas de dados mais comuns do sistema tormenta20 para Foundry. Como o sistema pode variar entre versões, alguns caminhos de dados têm **fallbacks automáticos**:

- `system.hp.value` → `system.pv.value` → `system.attributes.hp.value`
- `system.attributes.defense.value` → `system.defense.value` → `system.defesa.value`

Se o módulo não detectar os atributos corretamente, abra o console do Foundry (`F12`) e verifique a estrutura do `actor.system` do seu sistema e ajuste os caminhos nos arquivos de script.

---

## 📝 Licença

MIT License — sinta-se livre para modificar e distribuir.
