// hooks.js - Tormenta20 Attack Automation v1.6

Hooks.once("ready", () => {
  console.log("T20 Attack Automation | v1.6 carregado!");
  ui.notifications.info("⚔️ T20 Attack Automation ativo!");
});

// Extrai { tipo: total } ignorando operadores e termos sem valor numérico
function extrairDanoPorTipo(roll) {
  const porTipo = {};

  for (const term of roll.terms) {
    // Ignora operadores (+, -, etc) e parênteses
    if (term.constructor?.name === "OperatorTerm") continue;
    if (term.constructor?.name === "ParenthesisTerm") continue;

    const valor = term.total;
    // Ignora se não for número válido ou for zero sem dados
    if (valor === undefined || valor === null || isNaN(valor)) continue;
    // Ignora terms de dado que não rolaram nada
    if (typeof valor !== "number") continue;

    const flavor = (term.flavor ?? term.options?.flavor ?? "").toLowerCase().trim();
    const tipo = flavor || "sem_tipo";

    porTipo[tipo] = (porTipo[tipo] ?? 0) + valor;
  }

  return porTipo;
}

function calcularDanoComResistencias(valorBase, tipoNorm, tracos) {
  let dano = valorBase;
  const notas = [];

  if (tipoNorm && tipoNorm !== "sem_tipo") {
    const traco = tracos?.[tipoNorm];
    if (traco) {
      if (traco.imunidade) {
        return { dano: 0, notas: [`imune a ${tipoNorm}`] };
      }
      if (traco.vulnerabilidade) {
        dano *= 2;
        notas.push(`vuln. ×2`);
      } else if (traco.value > 0) {
        const antes = dano;
        dano = Math.max(0, dano - traco.value);
        notas.push(`RD ${traco.value}: ${antes}→${dano}`);
      }
    }
  }

  return { dano, notas };
}

Hooks.on("createChatMessage", async (message, options, userId) => {
  if (!message.rolls?.length) return;
  if (userId !== game.userId) return;

  const rollAtaque = message.rolls.find(r => r.formula?.includes("d20"));
  if (!rollAtaque) return;

  const rollDano = message.rolls.find(r => !r.formula?.includes("d20"));
  const targets = Array.from(game.user.targets);
  if (!targets.length) return;

  const totalAtaque = rollAtaque.total;
  const d20Result = rollAtaque.dice?.[0]?.results?.[0]?.result;
  const danoPorTipo = rollDano ? extrairDanoPorTipo(rollDano) : null;

  const dadosAlvos = targets.map(target => {
    const actor = target.actor;

    const defesa =
      actor.system?.attributes?.defesa?.value ??
      actor.system?.defesa?.value ?? 10;

    const pvAtual =
      foundry.utils.getProperty(actor, "system.attributes.pv.value") ?? "?";

    const pvMax =
      foundry.utils.getProperty(actor, "system.attributes.pv.max") ?? "?";

    const tracos = actor.system?.tracos?.resistencias ?? {};
    const rdGeral = parseInt(tracos?.dano?.value) || parseInt(tracos?.dano?.base) || parseInt(tracos?.perda?.value) || parseInt(tracos?.perda?.base) || 0;

    const erroNatural = d20Result === 1;
    const possivelCritico = d20Result >= 20;
    const acertou = !erroNatural && totalAtaque >= defesa;

    return {
      tokenId: target.id,
      nome: target.name,
      defesa, pvAtual, pvMax,
      rdGeral, tracos,
      acertou, erroNatural, possivelCritico
    };
  });

  await criarMensagemPublica(totalAtaque, dadosAlvos);

  if (game.user.isGM) {
    await criarMensagemGM(totalAtaque, dadosAlvos, danoPorTipo, rollDano?.total ?? null);
  } else {
    game.socket.emit("module.t20-attack-automation", {
      tipo: "atacou",
      totalAtaque, dadosAlvos,
      danoPorTipo,
      danoTotal: rollDano?.total ?? null
    });
  }
});

Hooks.once("ready", () => {
  game.socket.on("module.t20-attack-automation", async (data) => {
    if (!game.user.isGM) return;
    if (data.tipo === "atacou") {
      await criarMensagemGM(data.totalAtaque, data.dadosAlvos, data.danoPorTipo, data.danoTotal);
    }
  });
});

async function criarMensagemPublica(totalAtaque, dadosAlvos) {
  let html = `
    <div style="background:linear-gradient(135deg,#1a1200,#2a1e00);
      border:2px solid #7a5a00;border-radius:8px;padding:10px;
      color:#e8d5b7;font-family:'Palatino Linotype',serif;">
      <div style="color:#c9a227;font-weight:bold;font-size:1.05em;margin-bottom:8px">
        ⚔️ Ataque — Total: ${totalAtaque}
      </div>`;

  for (const a of dadosAlvos) {
    const cor = a.erroNatural ? "#888" : a.possivelCritico && a.acertou ? "#ff6b35" : a.acertou ? "#27ae60" : "#e74c3c";
    const label = a.erroNatural ? "💨 Erro Natural" : a.possivelCritico && a.acertou ? "⚔️ CRÍTICO!" : a.acertou ? "✅ Acertou!" : "❌ Errou";
    html += `
      <div style="display:flex;justify-content:space-between;align-items:center;
        padding:5px 8px;border-left:3px solid ${cor};margin-bottom:4px;
        background:rgba(255,255,255,0.03);border-radius:0 4px 4px 0">
        <b>${a.nome}</b>
        <span style="color:${cor};font-weight:bold">${label}</span>
      </div>`;
  }
  html += `</div>`;
  await ChatMessage.create({ content: html });
}

async function criarMensagemGM(totalAtaque, dadosAlvos, danoPorTipo, danoTotal) {
  const temDano = danoPorTipo && Object.keys(danoPorTipo).length > 0;

  let html = `
    <div style="background:linear-gradient(135deg,#0f0f1a,#1a1a2e);
      border:2px solid #5a3a1a;border-radius:8px;padding:12px;
      color:#e8d5b7;font-family:'Palatino Linotype',serif;">
      <div style="border-bottom:1px solid #5a3a1a;padding-bottom:8px;margin-bottom:10px">
        <span style="color:#c9a227;font-weight:bold">🎲 Painel do GM — Ataque: ${totalAtaque}</span>
        ${temDano ? `<span style="float:right;color:#e74c3c;font-weight:bold">Dano base: ${danoTotal}</span>` : ""}
      </div>`;

  for (const a of dadosAlvos) {
    const cor = a.erroNatural ? "#555" : a.possivelCritico && a.acertou ? "#ff6b35" : a.acertou ? "#27ae60" : "#e74c3c";
    const label = a.erroNatural ? "💨 Erro Natural" : a.possivelCritico && a.acertou ? "⚔️ CRÍTICO!" : a.acertou ? "✅ Acertou" : "❌ Errou";

    let danoFinalTotal = 0;
    let linhasDano = [];

    if (temDano && a.acertou) {
      const isCrit = a.possivelCritico;

      for (const [tipo, valor] of Object.entries(danoPorTipo)) {
        // Ignora entradas sem valor real
        if (isNaN(valor) || valor === null) continue;

        const tipoNorm = tipo === "perfuração" ? "perfuracao" : tipo;
        const valorCrit = isCrit ? valor * 2 : valor;

        const { dano, notas } = calcularDanoComResistencias(valorCrit, tipoNorm, a.tracos);
        danoFinalTotal += dano;

        const notaStr = notas.length ? ` (${notas.join(", ")})` : "";
        const critStr = isCrit ? ` ×2` : "";
        const tipoLabel = tipo !== "sem_tipo" ? tipo : "sem tipo específico";
        const corLinha = dano === 0 ? "#666" : dano < valorCrit ? "#e67e22" : "#ccc";

        linhasDano.push(`
          <div style="font-size:0.82em;color:${corLinha};padding:2px 0">
            ${tipoLabel}: ${valor}${critStr} → <b>${dano}</b>${notaStr}
          </div>`);
      }

      // RD geral aplicada ao total
      if (a.rdGeral > 0 && danoFinalTotal > 0) {
        const antes = danoFinalTotal;
        danoFinalTotal = Math.max(0, danoFinalTotal - a.rdGeral);
        linhasDano.push(`
          <div style="font-size:0.82em;color:#aaa;padding:2px 0;
            border-top:1px solid rgba(255,255,255,0.08);margin-top:2px">
            RD geral ${a.rdGeral}: ${antes} → <b>${danoFinalTotal}</b>
          </div>`);
      }
    }

    // Resumo de resistências relevantes
    const resInfo = Object.entries(a.tracos ?? {})
      .filter(([k, v]) => k !== "perda" && k !== "dano" && (v?.imunidade || v?.vulnerabilidade || v?.value > 0))
      .map(([k, v]) => v?.imunidade ? `🛡️${k}` : v?.vulnerabilidade ? `⚡${k}` : `RD${v.value}[${k}]`)
      .join(" · ");

    html += `
      <div style="border-left:4px solid ${cor};padding:8px 10px;margin-bottom:6px;
        border-radius:0 4px 4px 0;background:rgba(255,255,255,0.03)">
        <div style="display:flex;justify-content:space-between">
          <b>${a.nome}</b>
          <span style="color:${cor};font-weight:bold">${label}</span>
        </div>
        <div style="font-size:0.8em;color:#888;margin-top:3px">
          DEF ${a.defesa} · PV ${a.pvAtual}/${a.pvMax}
          ${a.rdGeral > 0 ? ` · RD geral ${a.rdGeral}` : ""}
          ${resInfo ? ` · ${resInfo}` : ""}
        </div>
        ${a.acertou && temDano ? `
        <div style="margin-top:6px;padding:4px 6px;background:rgba(0,0,0,0.2);border-radius:4px">
          ${linhasDano.join("")}
          <div style="font-size:0.9em;font-weight:bold;color:#e8d5b7;margin-top:4px;
            border-top:1px solid rgba(255,255,255,0.1);padding-top:4px">
            Total final: ${danoFinalTotal}
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="t20-aplicar"
            data-token="${a.tokenId}"
            data-dano="${danoFinalTotal}"
            style="flex:1;padding:5px;border-radius:4px;cursor:pointer;
              background:#7a1a1a;border:1px solid #a02020;color:#fff;font-size:0.85em">
            💔 Aplicar ${danoFinalTotal} de Dano
          </button>
          <button class="t20-metade"
            data-token="${a.tokenId}"
            data-dano="${Math.floor(danoFinalTotal / 2)}"
            style="flex:1;padding:5px;border-radius:4px;cursor:pointer;
              background:#2c3e50;border:1px solid #3d5166;color:#fff;font-size:0.85em">
            🛡️ Metade (${Math.floor(danoFinalTotal / 2)})
          </button>
        </div>` : a.acertou ? `
        <div style="font-size:0.8em;color:#e67e22;margin-top:6px">
          ⚠️ Nenhum roll de dano encontrado.
        </div>` : ""}
      </div>`;
  }

  html += `</div>`;

  const novaMsg = await ChatMessage.create({
    content: html,
    whisper: ChatMessage.getWhisperRecipients("GM")
  });

  Hooks.once("renderChatMessage", (msg, html) => {
    if (msg.id !== novaMsg.id) return;
    html[0].querySelectorAll(".t20-aplicar, .t20-metade").forEach(btn =>
      btn.addEventListener("click", () => aplicarDano(btn))
    );
  });
}

async function aplicarDano(btn) {
  const tokenId = btn.dataset.token;
  const dano    = parseInt(btn.dataset.dano) || 0;
  const token   = canvas.tokens.get(tokenId);
  if (!token) return;

  if (dano <= 0) {
    return ChatMessage.create({
      content: `🛡️ <b>${token.name}</b> absorveu todo o dano.`
    });
  }

  const hpPath  = "system.attributes.pv.value";
  const pvAtual = foundry.utils.getProperty(token.actor, hpPath);
  if (pvAtual === undefined) return ui.notifications.warn("PV não encontrado!");

  const pvMax  = foundry.utils.getProperty(token.actor, "system.attributes.pv.max") ?? pvAtual;
  const novoPV = Math.max(0, pvAtual - dano);

  await token.actor.update({ [hpPath]: novoPV });

  const cor = novoPV === 0 ? "red" : novoPV <= pvMax / 2 ? "orange" : "green";

  ChatMessage.create({
    content: `💔 <b>${token.name}</b> sofreu <b>${dano} de dano</b>.<br>
      PV: ${pvAtual} → <span style="color:${cor}"><b>${novoPV}</b></span>
      ${novoPV === 0 ? "<br>💀 <b>Incapacitado!</b>" : ""}`
  });

  btn.closest("div").querySelectorAll("button")
    .forEach(b => { b.disabled = true; b.style.opacity = "0.5"; });
}


// ============================================================
// SALVAMENTOS - Detecta magias/habilidades com teste de resistência
// ============================================================

// Mapa de perícias de salvamento para atributo e label
const SALV_MAP = {
  refl: { label: "Reflexos",  atributo: "des" },
  fort: { label: "Fortitude", atributo: "con" },
  vont: { label: "Vontade",   atributo: "sab" },
  // fallback por texto
  reflexos:   { label: "Reflexos",  atributo: "des" },
  fortitude:  { label: "Fortitude", atributo: "con" },
  vontade:    { label: "Vontade",   atributo: "sab" },
};

Hooks.on("createChatMessage", async (message, options, userId) => {
  // Só processa quem enviou
  if (userId !== game.userId) return;

  // Verificar se é uma mensagem de uso de item com resistência
  const itemId  = message.flags?.tormenta20?.itemId ?? message.flags?.itemId;
  const actorId = message.speaker?.actor;
  if (!itemId || !actorId) return;

  const actor = game.actors.get(actorId);
  if (!actor) return;

  const item = actor.items.get(itemId);
  if (!item) return;

  const resistencia = item.system?.resistencia;
  if (!resistencia) return;

  // Detectar perícia de salvamento
  const pericia = (resistencia.percia ?? resistencia.pericia ?? "").toLowerCase();
  const txt     = (resistencia.txt ?? "").toLowerCase();

  // Tentar identificar pelo campo pericia, senão pelo texto
  let salvInfo = SALV_MAP[pericia];
  if (!salvInfo) {
    for (const [key, val] of Object.entries(SALV_MAP)) {
      if (txt.includes(key)) { salvInfo = val; break; }
    }
  }
  if (!salvInfo) return; // sem salvamento identificável

  // CD do conjurador
  const cd = actor.system?.attributes?.cd ?? 10;

  // Efeito em caso de sucesso (extrair do txt)
  const efeitoSucesso = txt || "reduz à metade";

  // Tipo de dano da magia (para referência)
  const rolls = item.system?.rolls ?? [];
  const tipoDano = rolls[0]?.parts?.[0]?.[1] ?? "";
  const formulaDano = rolls[0]?.parts?.[0]?.[0] ?? "";

  await criarCartaoSalvamento({
    nomeItem: item.name,
    imgItem: item.img,
    nomeConjurador: actor.name,
    salvLabel: salvInfo.label,
    salvAtributo: salvInfo.atributo,
    cd,
    efeitoSucesso,
    tipoDano,
    formulaDano,
    messageId: message.id,
  });
});

async function criarCartaoSalvamento(dados) {
  const {
    nomeItem, imgItem, nomeConjurador,
    salvLabel, salvAtributo, cd,
    efeitoSucesso, tipoDano, formulaDano
  } = dados;

  const html = `
    <div style="
      background:linear-gradient(135deg,#0a1a0a,#0f2a1a);
      border:2px solid #1a6a2a;border-radius:8px;padding:12px;
      color:#e8d5b7;font-family:'Palatino Linotype',serif;">
      <div style="display:flex;align-items:center;gap:10px;
        border-bottom:1px solid #1a6a2a;padding-bottom:8px;margin-bottom:10px">
        <img src="${imgItem}" style="width:34px;height:34px;border-radius:4px;
          border:1px solid #c9a227;object-fit:cover"/>
        <div>
          <div style="color:#c9a227;font-weight:bold">${nomeItem}</div>
          <div style="font-size:0.78em;color:#888">por ${nomeConjurador}</div>
        </div>
        <div style="margin-left:auto;text-align:center">
          <div style="font-size:0.7em;color:#aaa;text-transform:uppercase">CD</div>
          <div style="font-size:1.6em;font-weight:bold;color:#e74c3c;
            text-shadow:0 0 10px rgba(231,76,60,0.4)">${cd}</div>
        </div>
      </div>

      <div style="font-size:0.85em;color:#aaa;margin-bottom:10px">
        🎲 Teste de <b style="color:#e8d5b7">${salvLabel}</b> CD ${cd}
        ${efeitoSucesso ? `<br><span style="font-size:0.9em">✅ Sucesso: ${efeitoSucesso}</span>` : ""}
        ${formulaDano ? `<br><span style="font-size:0.9em">💥 Dano: ${formulaDano}${tipoDano ? ` [${tipoDano}]` : ""}</span>` : ""}
      </div>

      <button class="t20-salvar"
        data-salv-atributo="${salvAtributo}"
        data-salv-label="${salvLabel}"
        data-cd="${cd}"
        data-item="${nomeItem}"
        style="width:100%;padding:8px;border-radius:5px;cursor:pointer;font-size:0.95em;
          background:linear-gradient(135deg,#1a4a1a,#2a6a2a);
          border:1px solid #3a8a3a;color:#fff;font-weight:bold">
        🎲 Rolar ${salvLabel} (CD ${cd})
      </button>
    </div>`;

  const novaMsg = await ChatMessage.create({ content: html });

  Hooks.once("renderChatMessage", (msg, html) => {
    if (msg.id !== novaMsg.id) return;
    html[0].querySelectorAll(".t20-salvar").forEach(btn =>
      btn.addEventListener("click", () => rolarSalvamento(btn))
    );
  });
}

async function rolarSalvamento(btn) {
  const salvAtributo = btn.dataset.salvAtributo;
  const salvLabel    = btn.dataset.salvLabel;
  const cd           = parseInt(btn.dataset.cd);
  const nomeItem     = btn.dataset.item;

  // Pegar o personagem do jogador que clicou
  const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
  if (!actor) return ui.notifications.warn("Selecione seu token antes de rolar!");

  // Buscar valor da perícia de salvamento
  const pericias = actor.system?.pericias ?? {};

  // Mapa de atributo → chave da perícia no sistema T20
  const atributoParaPericia = {
    des: "refl",
    con: "fort",
    sab: "vont",
  };

  const chavePericia = atributoParaPericia[salvAtributo];
  const pericia = pericias[chavePericia];
  const valorPericia = pericia?.value ?? pericia?.outros ?? 0;
  const atribBase = actor.system?.atributos?.[salvAtributo]?.value ?? 0;
  const bonus = valorPericia + atribBase;

  const roll = await new Roll(`1d20 + ${bonus}`).evaluate();
  const sucesso = roll.total >= cd;

  const cor = sucesso ? "#27ae60" : "#e74c3c";
  const label = sucesso ? "✅ SUCESSO!" : "❌ FALHOU!";

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `
      <div style="font-family:'Palatino Linotype',serif">
        <b>${salvLabel}</b> contra <b>${nomeItem}</b> (CD ${cd})<br>
        <span style="color:${cor};font-weight:bold;font-size:1.1em">${label}</span>
        ${sucesso ? "<br><span style='font-size:0.85em;color:#aaa'>Efeito reduzido</span>" : ""}
      </div>`,
  });
}
