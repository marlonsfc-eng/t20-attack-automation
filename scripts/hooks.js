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

const SALV_MAP = {
  refl:       { label: "Reflexos",   atributo: "des", pericia: "refl" },
  fort:       { label: "Fortitude",  atributo: "con", pericia: "fort" },
  vont:       { label: "Vontade",    atributo: "sab", pericia: "vont" },
  reflexos:   { label: "Reflexos",   atributo: "des", pericia: "refl" },
  fortitude:  { label: "Fortitude",  atributo: "con", pericia: "fort" },
  vontade:    { label: "Vontade",    atributo: "sab", pericia: "vont" },
};

Hooks.on("createChatMessage", async (message, options, userId) => {
  if (userId !== game.userId) return;

  const actorId = message.speaker?.actor;
  if (!actorId) return;

  // T20 guarda os dados do item em flags.tormenta20.itemData
  const itemData = message.flags?.tormenta20?.itemData;
  if (!itemData) return;

  const resistencia = itemData?.resistencia;
  if (!resistencia?.txt && !resistencia?.pericia) return;

  // Ignorar se não houver texto de salvamento
  const txt = (resistencia.txt ?? "").toLowerCase();
  if (!txt) return;

  const actor = game.actors.get(actorId);
  if (!actor) return;

  // Detectar tipo de salvamento pelo campo pericia ou pelo texto
  const pericia = (resistencia.pericia ?? "").toLowerCase();
  let salvInfo = SALV_MAP[pericia];
  if (!salvInfo) {
    for (const [key, val] of Object.entries(SALV_MAP)) {
      if (txt.includes(key)) { salvInfo = val; break; }
    }
  }
  if (!salvInfo) return;

  // Nome e imagem do item pelo HTML da mensagem
  const nomeMatch = message.content?.match(/title="([^"]+)"/);
  const imgMatch  = message.content?.match(/img[^>]+src="([^"]+)"/);
  const nomeItem  = nomeMatch?.[1] ?? "Habilidade";
  const imgItem   = imgMatch?.[1]  ?? "";

  // CD do conjurador: 15 + atributo de conjuração + bônus de onUseEffects
  const atribConjuracao = actor.system?.attributes?.conjuracao ?? "int";
  const valorAtrib = actor.system?.atributos?.[atribConjuracao]?.value ?? 0;

  // Extrair bônus de CD dos efeitos ativos (ex: "Fortalecimento Arcano: +1 na CD de magias")
  const onUseEffects = message.flags?.tormenta20?.onUseEffects ?? [];
  let bonusCD = 0;
  for (const efeito of onUseEffects) {
    const desc = efeito.description ?? "";
    // Procura padrões como "+1 na CD" ou "+2 na CD"
    const match = desc.match(/\+(\d+)\s+na\s+CD/i);
    if (match) {
      bonusCD += parseInt(match[1]) * (parseInt(efeito.qty) || 1);
    }
  }

  const cd = 15 + valorAtrib + bonusCD;

  // Dano da magia
  const rolls       = itemData?.rolls ?? [];
  const tipoDano    = rolls[0]?.parts?.[0]?.[1] ?? "";
  const formulaDano = rolls[0]?.parts?.[0]?.[0] ?? "";

  // Dano já rolado na mesma mensagem
  const rollDanoMagia = message.rolls?.find(r => !r.formula?.includes("d20"));
  const danoRolado = rollDanoMagia?.total ?? null;

  await criarCartaoSalvamento({
    nomeItem,
    imgItem,
    nomeConjurador: actor.name,
    salvLabel:    salvInfo.label,
    salvPericia:  salvInfo.pericia,
    salvAtributo: salvInfo.atributo,
    cd,
    efeitoSucesso: resistencia.txt,
    tipoDano,
    formulaDano,
    danoRolado,
  });
});

async function criarCartaoSalvamento({ nomeItem, imgItem, nomeConjurador,
    salvLabel, salvPericia, salvAtributo, cd, efeitoSucesso, tipoDano, formulaDano, danoRolado }) {

  const html = `
    <div style="
      background:linear-gradient(135deg,#0a1a0a,#0f2a1a);
      border:2px solid #1a6a2a;border-radius:8px;padding:12px;
      color:#e8d5b7;font-family:'Palatino Linotype',serif;">
      <div style="display:flex;align-items:center;gap:10px;
        border-bottom:1px solid #1a6a2a;padding-bottom:8px;margin-bottom:10px">
        ${imgItem ? `<img src="${imgItem}" style="width:34px;height:34px;border-radius:4px;border:1px solid #c9a227;object-fit:cover"/>` : ""}
        <div>
          <div style="color:#c9a227;font-weight:bold">${nomeItem}</div>
          <div style="font-size:0.78em;color:#888">por ${nomeConjurador}</div>
        </div>
        <div style="margin-left:auto;text-align:center">
          <div style="font-size:0.7em;color:#aaa;text-transform:uppercase">CD</div>
          <input type="number" class="t20-cd-input" value="${cd}" style="width:50px;text-align:center;font-size:1.3em;font-weight:bold;color:#e74c3c;background:transparent;border:1px solid #e74c3c33;border-radius:4px;padding:2px"/>
        </div>
      </div>
      <div style="font-size:0.85em;color:#aaa;margin-bottom:10px">
        🎲 Teste de <b style="color:#e8d5b7">${salvLabel}</b> CD ${cd}
        ${efeitoSucesso ? `<br>✅ Sucesso: ${efeitoSucesso}` : ""}
        ${formulaDano   ? `<br>💥 Dano: ${formulaDano}${tipoDano ? ` [${tipoDano}]` : ""}` : ""}
      </div>
      <button class="t20-salvar"
        data-salv-pericia="${salvPericia}"
        data-salv-label="${salvLabel}"
        data-cd="${cd}"
        data-item="${nomeItem}"
        data-dano="${danoRolado ?? 0}"
        data-tipo-dano="${tipoDano}"
        style="width:100%;padding:8px;border-radius:5px;cursor:pointer;font-size:0.95em;
          background:linear-gradient(135deg,#1a4a1a,#2a6a2a);
          border:1px solid #3a8a3a;color:#fff;font-weight:bold">
        🎲 Rolar ${salvLabel} (CD ${cd})${danoRolado ? ` — Dano: ${danoRolado}` : ""}
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
  const salvPericia = btn.dataset.salvPericia;
  const salvLabel   = btn.dataset.salvLabel;
  const cdInput     = btn.closest("div")?.querySelector(".t20-cd-input");
  const cd          = cdInput ? parseInt(cdInput.value) : parseInt(btn.dataset.cd);
  const nomeItem    = btn.dataset.item;
  const danoBase    = parseInt(btn.dataset.dano) || 0;
  const tipoDano    = (btn.dataset.tipoDano ?? "").toLowerCase();

  const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
  if (!actor) return ui.notifications.warn("Selecione seu token antes de rolar!");

  const pericias = actor.system?.pericias ?? {};
  const pericia  = pericias[salvPericia];
  const bonus    = pericia?.value ?? 0;

  const roll    = await new Roll(`1d20 + ${bonus}`).evaluate();
  const sucesso = roll.total >= cd;
  const cor     = sucesso ? "#27ae60" : "#e74c3c";
  const label   = sucesso ? "✅ SUCESSO!" : "❌ FALHOU!";

  let danoFinal = sucesso ? Math.floor(danoBase / 2) : danoBase;
  let notaDano  = "";

  if (danoBase > 0) {
    const tracos  = actor.system?.tracos?.resistencias ?? {};
    const tipoNorm = tipoDano || null;
    const traco   = tipoNorm ? tracos?.[tipoNorm] : null;

    if (traco?.imunidade) {
      danoFinal = 0;
      notaDano  = `Imune a ${tipoDano}! Nenhum dano.`;
    } else {
      if (traco?.vulnerabilidade) {
        danoFinal *= 2;
        notaDano += ` (vuln. ${tipoDano}: ×2)`;
      } else if (traco?.value > 0) {
        const antes = danoFinal;
        danoFinal   = Math.max(0, danoFinal - parseInt(traco.value));
        notaDano   += ` (RD ${traco.value} [${tipoDano}]: ${antes}→${danoFinal})`;
      }

      const rdGeral = parseInt(tracos?.dano?.value) || parseInt(tracos?.dano?.base) || 0;
      if (rdGeral > 0 && danoFinal > 0) {
        const antes = danoFinal;
        danoFinal   = Math.max(0, danoFinal - rdGeral);
        notaDano   += ` (RD geral ${rdGeral}: ${antes}→${danoFinal})`;
      }

      const prefixo = sucesso
        ? `Sucesso! Dano reduzido: ${danoBase}→${Math.floor(danoBase/2)}`
        : `Falhou! Dano total: ${danoBase}`;
      notaDano = prefixo + notaDano;

      if (danoFinal > 0) {
        const hpPath  = "system.attributes.pv.value";
        const pvAtual = foundry.utils.getProperty(actor, hpPath);
        const pvMax   = foundry.utils.getProperty(actor, "system.attributes.pv.max") ?? pvAtual;
        if (pvAtual !== undefined) {
          const novoPV = Math.max(0, pvAtual - danoFinal);
          await actor.update({ [hpPath]: novoPV });
          const corPV = novoPV === 0 ? "red" : novoPV <= pvMax / 2 ? "orange" : "green";
          notaDano += `<br>💔 ${danoFinal} de dano. PV: ${pvAtual} → <span style="color:${corPV}"><b>${novoPV}</b></span>`;
          if (novoPV === 0) notaDano += "<br>💀 <b>Incapacitado!</b>";
        }
      } else {
        notaDano += "<br>Nenhum dano aplicado.";
      }
    }
  }

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `
      <div style="font-family:'Palatino Linotype',serif">
        <b>${salvLabel}</b> contra <i>${nomeItem}</i> (CD ${cd})<br>
        <span style="color:${cor};font-weight:bold;font-size:1.1em">${label}</span>
        ${notaDano ? `<br><span style="font-size:0.85em;color:#ccc">${notaDano}</span>` : ""}
      </div>`,
  });

  btn.disabled      = true;
  btn.style.opacity = "0.5";
  btn.textContent   = label + " (feito)";
}
