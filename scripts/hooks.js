// hooks.js - Tormenta20 Attack Automation v1.4

Hooks.once("ready", () => {
  console.log("T20 Attack Automation | v1.4 carregado!");
  ui.notifications.info("⚔️ T20 Attack Automation ativo!");
});

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
  const danoBase = rollDano ? rollDano.total : null;

  // Detectar tipo de dano pela fórmula do roll (ex: "1d12[corte]")
  const formulaDano = rollDano?.formula ?? "";
  const flavorDano = (message.flavor ?? "") + " " + (message.content ?? "") + " " + formulaDano;

  const dadosAlvos = targets.map(target => {
    const actor = target.actor;

    const defesa =
      actor.system?.attributes?.defesa?.value ??
      actor.system?.defesa?.value ?? 10;

    const pvAtual =
      foundry.utils.getProperty(actor, "system.attributes.pv.value") ?? "?";

    const pvMax =
      foundry.utils.getProperty(actor, "system.attributes.pv.max") ?? "?";

    // Ler resistências do caminho correto: system.tracos.resistencias
    const tracos = actor.system?.tracos?.resistencias ?? {};

    // RD geral (campo "perda" ou "dano")
    const rdGeral = tracos?.perda?.value ?? tracos?.dano?.value ?? 0;

    return {
      tokenId: target.id,
      nome: target.name,
      defesa, pvAtual, pvMax,
      rdGeral,
      tracos, // passa o objeto completo para processar depois
      acertou: !( d20Result === 1 ) && totalAtaque >= defesa,
      erroNatural: d20Result === 1,
      possivelCritico: d20Result >= 20
    };
  });

  await criarMensagemPublica(totalAtaque, dadosAlvos);

  if (game.user.isGM) {
    await criarMensagemGM(totalAtaque, dadosAlvos, danoBase, flavorDano);
  } else {
    game.socket.emit("module.t20-attack-automation", {
      tipo: "atacou",
      totalAtaque,
      dadosAlvos,
      danoBase,
      flavorDano
    });
  }
});

Hooks.once("ready", () => {
  game.socket.on("module.t20-attack-automation", async (data) => {
    if (!game.user.isGM) return;
    if (data.tipo === "atacou") {
      await criarMensagemGM(data.totalAtaque, data.dadosAlvos, data.danoBase, data.flavorDano);
    }
  });
});

// Mensagem pública (todos veem, sem PV/Defesa)
async function criarMensagemPublica(totalAtaque, dadosAlvos) {
  let html = `
    <div style="
      background:linear-gradient(135deg,#1a1200,#2a1e00);
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

// Mensagem privada do GM
async function criarMensagemGM(totalAtaque, dadosAlvos, danoBase, flavorDano) {
  const temDano = danoBase !== null && danoBase !== undefined;

  // Detectar tipo de dano pelo texto (fórmula + flavor)
  const texto = flavorDano.toLowerCase();
  const tiposConhecidos = ["acido","corte","eletricidade","essencia","fogo","frio",
                           "impacto","luz","psiquico","perfuracao","perfuração","trevas"];
  const tipoDetectado = tiposConhecidos.find(t => texto.includes(t)) ?? null;
  // Normalizar perfuração
  const tipoNorm = tipoDetectado === "perfuração" ? "perfuracao" : tipoDetectado;

  let html = `
    <div style="
      background:linear-gradient(135deg,#0f0f1a,#1a1a2e);
      border:2px solid #5a3a1a;border-radius:8px;padding:12px;
      color:#e8d5b7;font-family:'Palatino Linotype',serif;">
      <div style="border-bottom:1px solid #5a3a1a;padding-bottom:8px;margin-bottom:10px">
        <span style="color:#c9a227;font-weight:bold">🎲 Painel do GM — Ataque: ${totalAtaque}</span>
        ${temDano ? `<span style="float:right;color:#e74c3c;font-weight:bold">Dano base: ${danoBase}</span>` : ""}
      </div>`;

  for (const a of dadosAlvos) {
    const cor = a.erroNatural ? "#555" : a.possivelCritico && a.acertou ? "#ff6b35" : a.acertou ? "#27ae60" : "#e74c3c";
    const label = a.erroNatural ? "💨 Erro Natural" : a.possivelCritico && a.acertou ? "⚔️ CRÍTICO!" : a.acertou ? "✅ Acertou" : "❌ Errou";

    // Calcular dano já com resistências para mostrar no botão
    let danoFinal = danoBase ?? 0;
    let notasRes = [];

    if (temDano && tipoNorm) {
      const tracoDano = a.tracos?.[tipoNorm];
      if (tracoDano) {
        if (tracoDano.imunidade) {
          danoFinal = 0;
          notasRes.push(`imune a ${tipoNorm}`);
        } else if (tracoDano.vulnerabilidade) {
          danoFinal = danoFinal * 2;
          notasRes.push(`vulnerável a ${tipoNorm}: ×2`);
        } else if (tracoDano.value > 0) {
          // RD específica para este tipo
          const rdEspecifica = tracoDano.value;
          const antes = danoFinal;
          danoFinal = Math.max(0, danoFinal - rdEspecifica);
          notasRes.push(`RD ${rdEspecifica} (${tipoNorm}): ${antes}→${danoFinal}`);
        }
      }
    }

    // RD geral (campo "perda") — aplica depois da RD específica
    if (temDano && a.rdGeral > 0 && danoFinal > 0) {
      const antes = danoFinal;
      danoFinal = Math.max(0, danoFinal - a.rdGeral);
      notasRes.push(`RD geral ${a.rdGeral}: ${antes}→${danoFinal}`);
    }

    const notaStr = notasRes.length ? ` (${notasRes.join(", ")})` : "";
    const tipoLabel = tipoNorm ? ` [${tipoNorm}]` : "";

    // Resumo de resistências para mostrar na ficha
    const resInfo = Object.entries(a.tracos ?? {})
      .filter(([_, v]) => v?.imunidade || v?.vulnerabilidade || v?.value > 0)
      .map(([k, v]) => v?.imunidade ? `Imune: ${k}` : v?.vulnerabilidade ? `Vuln: ${k}` : `RD ${v.value} (${k})`)
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
          ${a.rdGeral > 0 ? ` · RD ${a.rdGeral}` : ""}
          ${resInfo ? ` · ${resInfo}` : ""}
        </div>
        ${tipoNorm ? `<div style="font-size:0.78em;color:#aaa;margin-top:2px">Tipo detectado: ${tipoNorm}</div>` : ""}
        ${a.acertou && temDano ? `
        <div style="font-size:0.85em;color:#ccc;margin-top:6px">
          Dano calculado: <b>${danoFinal}</b>${notaStr}
        </div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="t20-aplicar"
            data-token="${a.tokenId}"
            data-dano-final="${danoFinal}"
            data-dano-base="${danoBase}"
            data-critico="${a.possivelCritico ? 1 : 0}"
            style="flex:1;padding:5px;border-radius:4px;cursor:pointer;
              background:#7a1a1a;border:1px solid #a02020;color:#fff;font-size:0.85em">
            💔 Aplicar ${danoFinal} de Dano${tipoLabel}
          </button>
          <button class="t20-metade"
            data-token="${a.tokenId}"
            data-dano-final="${Math.floor(danoFinal / 2)}"
            style="flex:1;padding:5px;border-radius:4px;cursor:pointer;
              background:#2c3e50;border:1px solid #3d5166;color:#fff;font-size:0.85em">
            🛡️ Metade (${Math.floor(danoFinal / 2)})
          </button>
        </div>` : a.acertou ? `
        <div style="font-size:0.8em;color:#e67e22;margin-top:6px">
          ⚠️ Nenhum roll de dano encontrado na mensagem.
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
    html[0].querySelectorAll(".t20-aplicar").forEach(btn =>
      btn.addEventListener("click", () => aplicarDano(btn))
    );
    html[0].querySelectorAll(".t20-metade").forEach(btn =>
      btn.addEventListener("click", () => aplicarDano(btn))
    );
  });
}

// Aplica o dano já calculado diretamente
async function aplicarDano(btn) {
  const tokenId  = btn.dataset.token;
  const dano     = parseInt(btn.dataset.danoFinal) || 0;
  const isCrit   = btn.dataset.critico === "1";

  const token = canvas.tokens.get(tokenId);
  if (!token) return;

  let danoFinal = isCrit ? dano * 2 : dano;

  if (danoFinal <= 0) {
    return ChatMessage.create({
      content: `🛡️ <b>${token.name}</b> absorveu todo o dano.`
    });
  }

  const hpPath = "system.attributes.pv.value";
  const pvAtual = foundry.utils.getProperty(token.actor, hpPath);
  if (pvAtual === undefined) return ui.notifications.warn("PV não encontrado!");

  const pvMax  = foundry.utils.getProperty(token.actor, "system.attributes.pv.max") ?? pvAtual;
  const novoPV = Math.max(0, pvAtual - danoFinal);

  await token.actor.update({ [hpPath]: novoPV });

  const cor = novoPV === 0 ? "red" : novoPV <= pvMax / 2 ? "orange" : "green";

  ChatMessage.create({
    content: `💔 <b>${token.name}</b> sofreu <b>${danoFinal} de dano</b>${isCrit ? " (crítico)" : ""}.<br>
      PV: ${pvAtual} → <span style="color:${cor}"><b>${novoPV}</b></span>
      ${novoPV === 0 ? "<br>💀 <b>Incapacitado!</b>" : ""}`
  });

  btn.closest("div").querySelectorAll("button")
    .forEach(b => { b.disabled = true; b.style.opacity = "0.5"; });
}
