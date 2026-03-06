import { MODULE_ID, getSetting } from "./hooks.js";
import { T20DamageAutomation } from "./damage-automation.js";
import { T20ConditionAutomation } from "./condition-automation.js";

export class T20AttackAutomation {

  // ── Intercepta antes da rolagem ──────────────────────────
  static async preRollAttack(actor, item, rollData) {
    // Verificar se há alvo quando exigido
    if (getSetting("targetRequired")) {
      const targets = game.user.targets;
      if (targets.size === 0) {
        ui.notifications.warn("Selecione um alvo antes de atacar!");
        return false;
      }
    }
    return true;
  }

  // ── Processa rolagem de ataque feita pelo sistema ─────────
  static async onRollAttack(actor, item, roll) {
    const targets = [...game.user.targets];
    if (!targets.length) {
      // Sem alvo: apenas mostra o resultado
      await this._createAttackCard(actor, item, roll, [], []);
      return;
    }

    const results = [];
    for (const target of targets) {
      const result = await this._resolveAttackVsTarget(actor, item, roll, target.actor);
      results.push(result);
    }

    if (getSetting("showAttackCard")) {
      await this._createAttackCard(actor, item, roll, targets, results);
    }

    // Processar dano para alvos acertados
    if (getSetting("enableDamageAutomation")) {
      for (const result of results) {
        if (result.hit) {
          await T20DamageAutomation.rollAndApplyDamage(actor, item, result.target, result.critical);
        }
      }
    }
  }

  // ── Fallback: detecta mensagem de ataque no chat ──────────
  static async handleAttackMessage(message) {
    const rollData = message.flags?.tormenta20?.roll;
    if (!rollData) return;

    const actor = game.actors.get(message.speaker.actor);
    if (!actor) return;

    const item = actor.items.get(rollData.itemId);
    if (!item) return;

    const roll = message.rolls?.[0];
    if (!roll) return;

    // Processar com a lógica principal
    await this.onRollAttack(actor, item, roll);
  }

  // ── Resolve ataque vs. defesa do alvo ────────────────────
  static async _resolveAttackVsTarget(actor, item, roll, targetActor) {
    const attackTotal = roll.total;
    const defense = this._getDefense(targetActor);
    const threat = this._getThreat(item);

    const d20Result = roll.dice[0]?.results[0]?.result;
    const naturalCrit = d20Result >= threat;
    const naturalMiss = d20Result === 1;

    let hit = false;
    let critical = false;

    if (naturalMiss) {
      hit = false;
    } else if (naturalCrit) {
      // Confirmar crítico: rolar novamente
      const confirmRoll = await new Roll(roll.formula).evaluate();
      critical = confirmRoll.total >= defense;
      hit = true; // crítico sempre acerta (após confirmação, hit é garantido)
    } else {
      hit = attackTotal >= defense;
    }

    return {
      target: targetActor,
      hit,
      critical,
      attackTotal,
      defense,
      d20Result,
      naturalCrit,
      naturalMiss,
    };
  }

  // ── Obtém a Defesa do alvo ────────────────────────────────
  static _getDefense(actor) {
    // Tenta diferentes caminhos de dados comuns no sistema T20
    return (
      actor.system?.attributes?.defense?.value ??
      actor.system?.defense?.value ??
      actor.system?.ca?.value ??
      actor.system?.defesa?.value ??
      10
    );
  }

  // ── Obtém o ameaça do item (para crítico) ─────────────────
  static _getThreat(item) {
    return (
      item.system?.critical?.threat ??
      item.system?.critico?.ameaca ??
      item.system?.threat ??
      20
    );
  }

  // ── Cria card visual no chat ──────────────────────────────
  static async _createAttackCard(actor, item, roll, targets, results) {
    const showDefense = getSetting("showDefenseValue");
    const isGM = game.user.isGM;

    const targetData = results.map((r) => ({
      name: r.target.name,
      img: r.target.img,
      defense:
        showDefense === "all" || (showDefense === "gm" && isGM)
          ? r.defense
          : "?",
      hit: r.hit,
      critical: r.critical,
      naturalMiss: r.naturalMiss,
      naturalCrit: r.naturalCrit,
      attackTotal: r.attackTotal,
      hitLabel: r.naturalMiss
        ? "Erro Natural!"
        : r.critical
        ? "CRÍTICO!"
        : r.hit
        ? "Acertou!"
        : "Errou!",
      hitClass: r.naturalMiss
        ? "miss natural"
        : r.critical
        ? "critical"
        : r.hit
        ? "hit"
        : "miss",
    }));

    const content = await renderTemplate(
      `modules/${MODULE_ID}/templates/attack-card.html`,
      {
        actor,
        item,
        roll,
        targets: targetData,
        hasTargets: targetData.length > 0,
        attackTotal: roll.total,
      }
    );

    await ChatMessage.create({
      user: game.userId,
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
      type: CONST.CHAT_MESSAGE_TYPES.OTHER,
      flags: {
        [MODULE_ID]: {
          type: "attackCard",
          actorId: actor.id,
          itemId: item.id,
          results,
        },
      },
    });
  }

  // ── Método público para uso via macro ────────────────────
  static async attackWithItem(itemName) {
    const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
    if (!actor) return ui.notifications.warn("Nenhum personagem selecionado!");

    const item = actor.items.find(
      (i) => i.name.toLowerCase() === itemName.toLowerCase()
    );
    if (!item) return ui.notifications.warn(`Item "${itemName}" não encontrado!`);

    // Usar o método de ataque do sistema
    if (item.rollAttack) {
      await item.rollAttack();
    } else if (item.roll) {
      await item.roll();
    } else {
      ui.notifications.error("Este item não suporta rolagem de ataque.");
    }
  }
}
