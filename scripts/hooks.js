// hooks.js - Tormenta20 Attack Automation v1.2

Hooks.once("ready", () => {
  console.log("T20 Attack Automation | Módulo carregado!");
  ui.notifications.info("⚔️ T20 Attack Automation ativo!");
});

Hooks.on("createChatMessage", async (message, options, userId) => {
  if (!message.rolls?.length) return;

  const rollAtaque = message.rolls.find(r => r.formula?.includes("d20"));
  if (!rollAtaque) return;

  const targets = Array.from(game.user.targets);
  if (!targets.length) return;

  // Só processa quem fez o ataque
  if (userId !== game.userId) return;

  const totalAtaque = rollAtaque.total;
  const d20Result = rollAtaque.dice?.[0]?.results?.[0]?.result;

  const dadosAlvos = targets.map(target => {
    const actor = target.actor;

    const defesa =
      actor.system?.attributes?.defesa?.value ??
      actor.system?.defesa?.value ?? 10;

    const pvAtual =
      foundry.utils.getProperty(actor, "system.attributes.pv.value") ??
      actor.system?.hp?.value ?? "?";

    const pvMax =
      foundry.utils.getProperty(actor, "system.attributes.pv.max") ??
      actor.system?.hp?.max ?? "?";

    const rd =
      actor.system?.attributes?.rd?.value ??
      actor.system?.rd?.value ?? 0;

    const resistencias =
      actor.system?.attributes?.resistencias ??
      actor.system?.resistencias ?? [];

    const imunidades =
      actor.system?.attributes?.imunidades ??
      actor.system?.imunidades ?? [];

    const erroNatural = d20Result === 1;
    const possivelCritico = d20Result >= 20;
    const acertou = !erroNatural && totalAtaque >= defesa;

    return {
      tokenId: target.id,
      nome: target.name,
      defesa, pvAtual, pvMax, rd,
      resistencias, imunidades,
      acertou, erroNatural, possivelCritico
    };
  });

  // Mensagem pública para todos (sem dados sensíveis)
  await criarMensagemPublica(totalAtaque, dadosAlvos);

  // Mensagem do GM (com PV, Defesa e botões)
  if (game.user.isGM) {
    await criarMensagemGM(totalAtaque, dadosAlvos, message.id);
  } else {
    // Jogador: pede ao GM via socket para criar a mensagem do GM
    game.socket.emit("module.t20-attack-automation", {
      tipo: "atacou",
      messageId: message.id,
      totalAtaque,
      dadosAlvos
    });
  }
});

// Socket: GM recebe pedidos dos jogadores
Hooks.once("ready", () => {
  game.socket.on("module.t20-attack-automation", async (data) => {
    if (!game.user.isGM) return;

    if (data.tipo === "atacou") {
      await criarMensagemGM(data.totalAtaque, data.dadosAlvos, data.messageId);
    }
  });
});

// Mensagem pública (todos veem, sem PV/Defesa)
async function criarMensagemPublica(totalAtaque, dadosAlvos) {
  let html = `
    <div style="
      background:linear-gradient(135deg,#1a1200,#2a1e00);
      border:2px solid #7a5a00;border-radius:8px;padding:10px;
      color:#e8d5b7;font-family:'Palatino Linotype',serif;
    ">
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

// Mensagem privada do GM (com botões de dano)
async function criarMensagemGM(totalAtaque, dadosAlvos, attackMessageId) {
  let html = `
    <div style="
      background:linear-gradient(135deg,#0f0f1a,#1a1a2e);
      border:2px solid #5a3a1a;border-radius:8px;padding:12px;
      color:#e8d5b7;font-family:'Palatino Linotype',serif;
    ">
      <div style="border-bottom:1px solid #5a3a1a;padding-bottom:8px;margin-bottom:10px">
        <span style="color:#c9a227;font-weight:bold">🎲 Painel do GM — Ataque: ${totalAtaque}</span>
      </div>`;

  for (const a of dadosAlvos) {
    const cor = a.erroNatural ? "#555" : a.possivelCritico && a.acertou ? "#ff6b35" : a.acertou ? "#27ae60" : "#e74c3c";
    const label = a.erroNatural ? "💨 Erro Natural" : a.possivelCritico && a.acertou ? "⚔️ CRÍTICO!" : a.acertou ? "✅ Acertou" : "❌ Errou";

    html += `
      <div style="border-left:4px solid ${cor};padding:8px 10px;margin-bottom:6px;
        border-radius:0 4px 4px 0;background:rgba(255,255,255,0.03)">
        <div style="display:flex;justify-content:space-between">
          <b>${a.nome}</b>
          <span style="color:${cor};font-weight:bold">${label}</span>
        </div>
        <div style="font-size:0.8em;color:#888;margin-top:3px">
          DEF ${a.defesa} · PV ${a.pvAtual}/${a.pvMax}
          ${a.rd > 0 ? ` · RD ${a.rd}` : ""}
          ${a.resistencias.length ? ` · Res: ${a.resistencias.join(", ")}` : ""}
          ${a.imunidades.length ? ` · Imune: ${a.imunidades.join(", ")}` : ""}
        </div>
        ${a.acertou ? `
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="t20-aplicar"
            data-token="${a.tokenId}"
            data-rd="${a.rd}"
            data-resistencias='${JSON.stringify(a.resistencias)}'
            data-imunidades='${JSON.stringify(a.imunidades)}'
            data-critico="${a.possivelCritico ? 1 : 0}"
            data-attack-msg="${attackMessageId}"
            style="flex:1;padding:5px;border-radius:4px;cursor:pointer;
              background:#7a1a1a;border:1px solid #a02020;color:#fff;font-size:0.85em">
            💔 Aplicar Dano
          </button>
          <button class="t20-metade"
            data-token="${a.tokenId}"
            data-rd="${a.rd}"
            data-resistencias='${JSON.stringify(a.resistencias)}'
            data-imunidades='${JSON.stringify(a.imunidades)}'
            data-attack-msg="${attackMessageId}"
            style="flex:1;padding:5px;border-radius:4px;cursor:pointer;
              background:#2c3e50;border:1px solid #3d5166;color:#fff;font-size:0.85em">
            🛡️ Metade
          </button>
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
      btn.addEventListener("click", () => clicarDano(btn, false))
    );
    html[0].querySelectorAll(".t20-metade").forEach(btn =>
      btn.addEventListener("click", () => clicarDano(btn, true))
    );
  });
}

// Clique no botão de dano
async function clicarDano(btn, metade) {
  const attackMsgId = btn.dataset.attackMsg;

  // Busca mensagem de dano após a mensagem de ataque
  const todasMsgs = game.messages.contents;
  const idxAtaque = todasMsgs.findIndex(m => m.id === attackMsgId);

  let msgDano = null;

  if (idxAtaque >= 0) {
    for (let i = idxAtaque + 1; i < todasMsgs.length; i++) {
      const m = todasMsgs[i];
      if (m.rolls?.length && !m.rolls.some(r => r.formula?.includes("d20"))) {
        msgDano = m;
        break;
      }
    }
  }

  // Fallback: última mensagem com dano no chat
  if (!msgDano) {
    msgDano = todasMsgs.slice().reverse()
      .find(m => m.rolls?.length && !m.rolls.some(r => r.formula?.includes("d20")));
  }

  if (!msgDano) {
    return ui.notifications.warn("⚠️ Role o dano primeiro, depois clique em Aplicar!");
  }

  const dados = {
    tokenId:      btn.dataset.token,
    rd:           parseInt(btn.dataset.rd) || 0,
    resistencias: JSON.parse(btn.dataset.resistencias || "[]"),
    imunidades:   JSON.parse(btn.dataset.imunidades   || "[]"),
    isCritico:    btn.dataset.critico === "1",
    metade,
    danoBase: msgDano.rolls.reduce((t, r) => t + (r.total ?? 0), 0),
    flavorDano: (msgDano.flavor ?? "") + " " + (msgDano.content ?? "")
  };

  await processarDano(dados);

  btn.closest("div").querySelectorAll("button")
    .forEach(b => { b.disabled = true; b.style.opacity = "0.5"; });
}

// Processa e aplica o dano
async function processarDano(dados) {
  const token = canvas.tokens.get(dados.tokenId);
  if (!token) return;

  let dano = dados.danoBase;

  if (dados.isCritico) dano *= 2;
  if (dados.metade) dano = Math.floor(dano / 2);

  const texto = dados.flavorDano.toLowerCase();
  const tipos = ["corte","perfuracao","perfuração","impacto","fogo","frio",
                 "eletricidade","acido","ácido","sonico","sônico","negativo","positivo","mental"];
  const tipo = tipos.find(t => texto.includes(t)) ?? null;

  if (tipo && dados.imunidades.map(i => i.toLowerCase()).includes(tipo)) {
    return ChatMessage.create({
      content: `🛡️ <b>${token.name}</b> é <b>imune a ${tipo}</b>! Dano ignorado.`
    });
  }

  let notaRes = "";
  if (tipo && dados.resistencias.map(r => r.toLowerCase()).includes(tipo)) {
    const antes = dano;
    dano = Math.floor(dano / 2);
    notaRes = ` (resistência a ${tipo}: ${antes}→${dano})`;
  }

  let notaRD = "";
  if (dados.rd > 0) {
    const antes = dano;
    dano = Math.max(0, dano - dados.rd);
    notaRD = ` (RD ${dados.rd}: ${antes}→${dano})`;
  }

  if (dano <= 0) {
    return ChatMessage.create({
      content: `🛡️ <b>${token.name}</b> absorveu todo o dano${notaRD}.`
    });
  }

  const hpPath = "system.attributes.pv.value";
  const pvAtual = foundry.utils.getProperty(token.actor, hpPath);
  if (pvAtual === undefined) return ui.notifications.warn("PV não encontrado!");

  const pvMax = foundry.utils.getProperty(token.actor, "system.attributes.pv.max") ?? pvAtual;
  const novoPV = Math.max(0, pvAtual - dano);

  await token.actor.update({ [hpPath]: novoPV });

  const cor = novoPV === 0 ? "red" : novoPV <= pvMax / 2 ? "orange" : "green";

  ChatMessage.create({
    content: `💔 <b>${token.name}</b> sofreu <b>${dano} de dano</b>${notaRes}${notaRD}.<br>
      PV: ${pvAtual} → <span style="color:${cor}"><b>${novoPV}</b></span>
      ${novoPV === 0 ? "<br>💀 <b>Incapacitado!</b>" : ""}`
  });
}
