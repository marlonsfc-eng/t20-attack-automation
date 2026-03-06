import { MODULE_ID, emitSocket } from "./hooks.js";

// Mapeamento completo das condições do Tormenta20
export const T20_CONDITIONS = {
  abalado: {
    id: "abalado",
    label: "Abalado",
    icon: "icons/svg/daze.svg",
    effects: ["Penalidade de -2 em testes"],
    foundryStatus: "frightened",
  },
  apavorado: {
    id: "apavorado",
    label: "Apavorado",
    icon: "icons/svg/terror.svg",
    effects: ["Não pode se aproximar da fonte do medo", "Penalidade de -2 em testes"],
    foundryStatus: "frightened",
  },
  agarrado: {
    id: "agarrado",
    label: "Agarrado",
    icon: "icons/svg/net.svg",
    effects: ["Preso, não pode se mover", "Penalidade de -2 em Ataque e Defesa"],
    foundryStatus: "restrained",
  },
  alquebrado: {
    id: "alquebrado",
    label: "Alquebrado",
    icon: "icons/svg/bones.svg",
    effects: ["-5 em todos os testes"],
    foundryStatus: "exhaustion",
  },
  atordoado: {
    id: "atordoado",
    label: "Atordoado",
    icon: "icons/svg/stoned.svg",
    effects: ["Perde a ação", "Penalidade de -5 em Defesa"],
    foundryStatus: "stunned",
  },
  caido: {
    id: "caido",
    label: "Caído",
    icon: "icons/svg/falling.svg",
    effects: ["Penalidade de -5 em Ataque", "Penalidade de -5 em Defesa"],
    foundryStatus: "prone",
  },
  cego: {
    id: "cego",
    label: "Cego",
    icon: "icons/svg/blind.svg",
    effects: ["Não pode ver", "Penalidade de -5 em Ataque", "Ataques contra você têm bônus de +5"],
    foundryStatus: "blinded",
  },
  confuso: {
    id: "confuso",
    label: "Confuso",
    icon: "icons/svg/chaos.svg",
    effects: ["Age aleatoriamente"],
    foundryStatus: "confused",
  },
  desprevenido: {
    id: "desprevenido",
    label: "Desprevenido",
    icon: "icons/svg/hazard.svg",
    effects: ["Penalidade de -5 em Defesa"],
    foundryStatus: "flatfooted",
  },
  enfraquecido: {
    id: "enfraquecido",
    label: "Enfraquecido",
    icon: "icons/svg/poison.svg",
    effects: ["Força reduzida à metade"],
    foundryStatus: "weakened",
  },
  enjoado: {
    id: "enjoado",
    label: "Enjoado",
    icon: "icons/svg/nauseated.svg",
    effects: ["Penalidade de -2 em Ataque, Defesa e testes"],
    foundryStatus: "sickened",
  },
  esmorecido: {
    id: "esmorecido",
    label: "Esmorecido",
    icon: "icons/svg/sleep.svg",
    effects: ["Penalidade de -2 em Ataque e dano"],
    foundryStatus: "incapacitated",
  },
  exausto: {
    id: "exausto",
    label: "Exausto",
    icon: "icons/svg/unconscious.svg",
    effects: ["Penalidade de -5 em Força e Destreza", "Velocidade reduzida à metade"],
    foundryStatus: "exhaustion",
  },
  fascinado: {
    id: "fascinado",
    label: "Fascinado",
    icon: "icons/svg/eye.svg",
    effects: ["Foco em um único estímulo", "Penalidade de -4 em Percepção"],
    foundryStatus: "charmed",
  },
  imobilizado: {
    id: "imobilizado",
    label: "Imobilizado",
    icon: "icons/svg/paralysis.svg",
    effects: ["Não pode se mover"],
    foundryStatus: "grappled",
  },
  inconsciente: {
    id: "inconsciente",
    label: "Inconsciente",
    icon: "icons/svg/unconscious.svg",
    effects: ["Indefeso", "Penalidade de -5 em Defesa", "Caído"],
    foundryStatus: "unconscious",
  },
  lento: {
    id: "lento",
    label: "Lento",
    icon: "icons/svg/slow.svg",
    effects: ["Velocidade reduzida à metade", "Penalidade de -2 em Defesa"],
    foundryStatus: "slowed",
  },
  morto: {
    id: "morto",
    label: "Morto",
    icon: "icons/svg/skull.svg",
    effects: ["Personagem está morto"],
    foundryStatus: "dead",
  },
  sangrando: {
    id: "sangrando",
    label: "Sangrando",
    icon: "icons/svg/blood.svg",
    effects: ["Perde 1d6 PV no início do turno"],
    foundryStatus: "bleeding",
    onTurnStart: async (actor) => {
      const roll = await new Roll("1d6").evaluate();
      await T20ConditionAutomation._applyBleedingDamage(actor, roll.total);
    },
  },
  surdo: {
    id: "surdo",
    label: "Surdo",
    icon: "icons/svg/deaf.svg",
    effects: ["Não pode ouvir", "Falha em testes que dependem de audição"],
    foundryStatus: "deafened",
  },
  vulneravel: {
    id: "vulneravel",
    label: "Vulnerável",
    icon: "icons/svg/target.svg",
    effects: ["Penalidade de -5 em Defesa"],
    foundryStatus: "vulnerable",
  },
};

export class T20ConditionAutomation {

  // ── Aplica condição a um ator ─────────────────────────────
  static async applyCondition(actor, conditionId) {
    const condition = T20_CONDITIONS[conditionId];
    if (!condition) {
      console.warn(`${MODULE_ID} | Condição desconhecida: ${conditionId}`);
      return;
    }

    if (!actor.isOwner && !game.user.isGM) {
      emitSocket("applyCondition", { actorId: actor.id, conditionId });
      return;
    }

    // Verificar se já tem a condição
    const hasCondition = actor.statuses?.has(condition.foundryStatus) ?? false;
    if (hasCondition) return;

    // Aplicar como Active Effect
    const effectData = {
      label: condition.label,
      icon: condition.icon,
      statusId: condition.foundryStatus,
      flags: {
        [MODULE_ID]: {
          conditionId,
          isT20Condition: true,
        },
      },
      changes: this._getConditionChanges(condition),
      statuses: [condition.foundryStatus],
    };

    await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);

    // Notificação no chat
    await ChatMessage.create({
      content: `<div class="t20-condition-applied">
        <img src="${condition.icon}" class="t20-condition-icon" />
        <span><strong>${actor.name}</strong> ficou <strong>${condition.label}</strong>!</span>
        <ul class="t20-condition-effects">
          ${condition.effects.map((e) => `<li>${e}</li>`).join("")}
        </ul>
      </div>`,
      speaker: { alias: "Sistema" },
    });
  }

  // ── Remove condição ───────────────────────────────────────
  static async removeCondition(actor, conditionId) {
    const condition = T20_CONDITIONS[conditionId];
    if (!condition) return;

    const effect = actor.effects.find(
      (e) => e.flags?.[MODULE_ID]?.conditionId === conditionId
    );
    if (effect) {
      await effect.delete();
    }
  }

  // ── Salvo para resistir à condição ───────────────────────
  static async rollSaveVsCondition(actor, conditionId, dc, attribute = "will") {
    const attrMap = {
      will: "von",
      fortitude: "vig",
      reflex: "des",
      von: "von",
      vig: "vig",
    };

    const attrKey = attrMap[attribute] ?? attribute;
    const attrValue =
      actor.system?.attributes?.[attrKey]?.value ??
      actor.system?.[attrKey]?.value ??
      0;

    const roll = await new Roll("1d20 + @attr", { attr: attrValue }).evaluate();

    const success = roll.total >= dc;
    const condition = T20_CONDITIONS[conditionId];

    await ChatMessage.create({
      content: `
        <div class="t20-save-card ${success ? "success" : "failure"}">
          <strong>${actor.name}</strong> rola salvamento contra ${condition?.label ?? conditionId}
          <div class="t20-save-result">Resultado: ${roll.total} vs. CD ${dc}</div>
          <div class="t20-save-outcome">${success ? "✓ Sucesso!" : "✗ Falhou!"}</div>
        </div>
      `,
      rolls: [roll],
      speaker: ChatMessage.getSpeaker({ actor }),
    });

    if (!success) {
      await this.applyCondition(actor, conditionId);
    }

    return success;
  }

  // ── Dano de sangramento ───────────────────────────────────
  static async _applyBleedingDamage(actor, damage) {
    const { T20DamageAutomation } = await import("./damage-automation.js");
    const hpPath = T20DamageAutomation._getHpPath(actor);
    const currentHp = foundry.utils.getProperty(actor.system, hpPath + ".value");

    if (currentHp === undefined) return;

    const newHp = Math.max(0, currentHp - damage);
    await actor.update({ [`system.${hpPath}.value`]: newHp });

    await ChatMessage.create({
      content: `<div class="t20-bleeding">
        🩸 <strong>${actor.name}</strong> perde <strong>${damage} PV</strong> por sangramento! (${currentHp} → ${newHp})
      </div>`,
      speaker: ChatMessage.getSpeaker({ actor }),
    });

    if (newHp <= 0) {
      await this.applyCondition(actor, "inconsciente");
    }
  }

  // ── Processa início de turno (para condições contínuas) ───
  static async onCombatantTurnStart(combatant) {
    const actor = combatant.actor;
    if (!actor) return;

    for (const [id, condition] of Object.entries(T20_CONDITIONS)) {
      if (condition.onTurnStart) {
        const hasCondition =
          actor.effects.some((e) => e.flags?.[MODULE_ID]?.conditionId === id);
        if (hasCondition) {
          await condition.onTurnStart(actor);
        }
      }
    }
  }

  // ── Recebe condição via socket ────────────────────────────
  static async applyConditionFromSocket(data) {
    if (!game.user.isGM) return;
    const actor = game.actors.get(data.actorId);
    if (actor) await this.applyCondition(actor, data.conditionId);
  }

  // ── Monta as mudanças de atributos da condição ────────────
  static _getConditionChanges(condition) {
    const changeMap = {
      caido: [
        { key: "system.attributes.attack.value", mode: 2, value: -5 },
        { key: "system.attributes.defense.value", mode: 2, value: -5 },
      ],
      abalado: [
        { key: "system.attributes.attack.value", mode: 2, value: -2 },
      ],
      atordoado: [
        { key: "system.attributes.defense.value", mode: 2, value: -5 },
      ],
      cego: [
        { key: "system.attributes.attack.value", mode: 2, value: -5 },
        { key: "system.attributes.defense.value", mode: 2, value: -5 },
      ],
      desprevenido: [
        { key: "system.attributes.defense.value", mode: 2, value: -5 },
      ],
      enjoado: [
        { key: "system.attributes.attack.value", mode: 2, value: -2 },
        { key: "system.attributes.defense.value", mode: 2, value: -2 },
      ],
      lento: [
        { key: "system.attributes.defense.value", mode: 2, value: -2 },
        { key: "system.movement.walk.value", mode: 1, value: 0.5 },
      ],
      vulneravel: [
        { key: "system.attributes.defense.value", mode: 2, value: -5 },
      ],
    };

    return changeMap[condition.id] ?? [];
  }
}

// ── Hook para turno de combate ────────────────────────────
Hooks.on("combatTurnChange", async (combat, priorState, currentState) => {
  const combatant = combat.combatants.get(currentState.combatantId);
  if (combatant) {
    await T20ConditionAutomation.onCombatantTurnStart(combatant);
  }
});
