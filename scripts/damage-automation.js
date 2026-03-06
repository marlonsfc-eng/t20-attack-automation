import { T20AttackAutomation } from "./attack-automation.js";
import { T20DamageAutomation } from "./damage-automation.js";
import { T20ConditionAutomation } from "./condition-automation.js";
import { T20AutomationUI } from "./ui.js";

export const MODULE_ID = "t20-attack-automation";
export const MODULE_NAME = "Tormenta20 Attack Automation";

// ── Inicialização ──────────────────────────────────────────
Hooks.once("init", () => {
  console.log(`${MODULE_NAME} | Inicializando módulo...`);

  // Registrar configurações
  registerSettings();

  // Registrar templates Handlebars
  loadTemplates([
    `modules/${MODULE_ID}/templates/attack-dialog.html`,
    `modules/${MODULE_ID}/templates/damage-card.html`,
  ]);
});

Hooks.once("ready", () => {
  console.log(`${MODULE_NAME} | Módulo pronto!`);
  T20AutomationUI.init();

  // Socket para sincronização entre jogadores
  game.socket.on(`module.${MODULE_ID}`, (data) => {
    if (data.type === "applyDamage") {
      T20DamageAutomation.applyDamageFromSocket(data);
    }
    if (data.type === "applyCondition") {
      T20ConditionAutomation.applyConditionFromSocket(data);
    }
  });
});

// ── Hook principal: intercepts item use ───────────────────
Hooks.on("tormenta20.preRollAttack", async (actor, item, rollData) => {
  if (!getSetting("enableAttackAutomation")) return true;
  return await T20AttackAutomation.preRollAttack(actor, item, rollData);
});

Hooks.on("tormenta20.rollAttack", async (actor, item, roll) => {
  if (!getSetting("enableAttackAutomation")) return;
  await T20AttackAutomation.onRollAttack(actor, item, roll);
});

// Fallback: intercepta via chat se o sistema não tem hooks próprios
Hooks.on("createChatMessage", async (message, options, userId) => {
  if (!getSetting("enableAttackAutomation")) return;
  if (userId !== game.userId) return;

  // Detectar se é uma rolagem de ataque do T20
  if (message.flags?.tormenta20?.roll?.type === "attack") {
    await T20AttackAutomation.handleAttackMessage(message);
  }
});

// ── Hook de dano ──────────────────────────────────────────
Hooks.on("tormenta20.rollDamage", async (actor, item, roll) => {
  if (!getSetting("enableDamageAutomation")) return;
  await T20DamageAutomation.onRollDamage(actor, item, roll);
});

// ── Hook de condições ─────────────────────────────────────
Hooks.on("tormenta20.applyCondition", async (actor, condition) => {
  if (!getSetting("enableConditionAutomation")) return;
  await T20ConditionAutomation.applyCondition(actor, condition);
});

// ── Registro de Configurações ─────────────────────────────
function registerSettings() {
  const debouncedReload = foundry.utils.debounce(() => window.location.reload(), 100);

  game.settings.register(MODULE_ID, "enableAttackAutomation", {
    name: "Automatizar Rolagens de Ataque",
    hint: "Rola automaticamente o ataque e processa acerto/erro/crítico.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "enableDamageAutomation", {
    name: "Automatizar Rolagens de Dano",
    hint: "Rola automaticamente o dano ao acertar um ataque.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "enableConditionAutomation", {
    name: "Automatizar Aplicação de Condições",
    hint: "Aplica automaticamente condições (abalado, sangrando, etc.) nos alvos.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "autoDamageApplication", {
    name: "Aplicação Automática de Dano",
    hint: "Como o dano é aplicado nos alvos selecionados.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      none: "Não aplicar automaticamente",
      ask: "Perguntar antes de aplicar",
      auto: "Aplicar automaticamente",
    },
    default: "ask",
  });

  game.settings.register(MODULE_ID, "showAttackCard", {
    name: "Mostrar Card de Ataque Expandido",
    hint: "Exibe informações detalhadas sobre o ataque no chat.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "criticalMultiplier", {
    name: "Multiplicador de Crítico",
    hint: "Multiplicador de dano em acertos críticos (padrão T20: 2x).",
    scope: "world",
    config: true,
    type: Number,
    default: 2,
    range: { min: 2, max: 4, step: 1 },
  });

  game.settings.register(MODULE_ID, "targetRequired", {
    name: "Exigir Alvo Selecionado",
    hint: "Exige que um alvo esteja selecionado para realizar o ataque.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "showDefenseValue", {
    name: "Exibir Defesa do Alvo",
    hint: "Exibe o valor de Defesa do alvo no card de ataque (requer ser GM ou ter permissão).",
    scope: "world",
    config: true,
    type: String,
    choices: {
      none: "Nunca mostrar",
      gm: "Apenas para o GM",
      all: "Para todos",
    },
    default: "gm",
  });
}

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}

export function emitSocket(type, data) {
  game.socket.emit(`module.${MODULE_ID}`, { type, ...data });
}
