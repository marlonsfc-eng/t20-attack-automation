// hooks.js - Tormenta20 Attack Automation
// Funciona interceptando createChatMessage (igual ao macro que funcionou)

const MODULE_ID = "t20-attack-automation";

Hooks.once("ready", () => {
  console.log("T20 Attack Automation | Módulo carregado!");
  ui.notifications.info("⚔️ T20 Attack Automation ativo!");
});

Hooks.on("createChatMessage", async (message, options, userId) => {
  if (!game.user.isGM) return;
  if (!message.rolls?.length) return;

  // Detecta rolagem de ataque (contém d20)
  const rollAtaque = message.rolls.find(r => r.formula?.includes("d20"));
  if (!rollAtaque) return;

  const targets = Array.from(game.user.targets);
  if (!targets.length) return;

  const totalAtaque = rollAtaque.total;
  const d20Result = rollAtaque.dice?.[0]?.results?.[0]?.result;

  let resultadoHTML = `
    <div style="
      background:linear-gradient(135deg,#0f0f1a,#1a1a2e);
      border:2px solid #5a3a1a;border-radius:8px;padding:12px;
      color:#e8d5b7;font-family:'Palatino Linotype',serif;
    ">
      <div style="border-bottom:1px solid #5a3a1a;padding-bottom:8px;margin-bottom:10px">
        <span style="color:#c9a227;font-weight:bold;font-size:1.1em">⚔️ Resultado do Ataque</span>
        <span style="float:right;font-size:1.8em;font-weight:bold;color:#c9a227">${totalAtaque}</span>
      </div>`;

  for (const target of targets) {
    const actor = target.actor;

    const defesa =
      actor.system?.attributes?.defesa?.value ??
      actor.system?.defesa?.value ??
      10;

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

    // Verificar crítico e erro natural
    const erroNatural = d20Result === 1;
    const ameaca = 20; // padrão T20, ajuste se necessário
    const possívelCritico = d20Result >= ameaca;
    const acertou = !erroNatural && totalAtaque >= defesa;

    const corBorda = erroNatural ? "#555" : possívelCritico && acertou ? "#ff6b35" : acertou ? "#27ae60" : "#e74c3c";
    const label = erroNatural ? "💨 Erro Natural!" : possívelCritico && acertou ? "⚔️ CRÍTICO!" : acertou ? "✅ Acertou!" : "❌ Errou!";

    const rdInfo = rd > 0 ? ` · RD ${rd}` : "";
    const resInfo = resistencias.length ? ` · Res: ${resistencias.join(", ")}` : "";
    const imuInfo = imunidades.length ? ` · Imune: ${imunidades.join(", ")}` : "";

    resultadoHTML += `
      <div style="
        border-left:4px solid ${corBorda};padding:8px 10px;
        margin-bottom:6px;border-radius:0 4px 4px 0;
        background:${acertou ? "rgba(39,174,96,0.08)" : "rgba(100,100,100,0.08)"};
      ">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <b>${target.name}</b>
          <span style="font-weight:bold;color:${corBorda}">${label}</span>
        </div>
        <div style="font-size:0.8em;color:#888;margin-top:3px">
          DEF ${defesa} · PV ${pvAtual}/${pvMax}${rdInfo}${resInfo}${imuInfo}
        </div>
        ${acertou ? `
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="t20-aplicar"
            data-token="${target.id}"
            data-rd="${rd}"
            data-resistencias='${JSON.stringify(resistencias)}'
            data-imunidades='${JSON.stringify(imunidades)}'
            data-critico="${possívelCritico ? 1 : 0}"
            style="flex:1;padding:5px;border-radius:4px;cursor:pointer;
              background:#7a1a1a;border:1px solid #a02020;color:#fff;font-size:0.85em">
            💔 Aplicar Dano
          </button>
          <button class="t20-metade"
            data-token="${target.id}"
            data-rd="${rd}"
            data-resistencias='${JSON.stringify(resistencias)}'
            data-imunidades='${JSON.stringify(imunidades)}'
            style="flex:1;padding:5px;border-radius:4px;cursor:pointer;
              background:#2c3e50;border:1px solid #3d5166;color:#fff;font-size:0.85em">
            🛡️ Metade
          </button>
        </div>` : ""}
      </div>`;
  }

  resultadoHTML += `</div>`;

  const novaMsg = await ChatMessage.create({
    content: resultadoHTML,
    whisper: ChatMessage.getWhisperRecipients("GM")
  });

  // Listener dos botões
  Hooks.once("renderChatMessage", (msg, html) => {
    if (msg.id !== novaMsg.id) return;

    const aplicar = async (btn, metade) => {
      const tokenId     = btn.dataset.token;
      const rd          = parseInt(btn.dataset.rd) || 0;
      const resistencias = JSON.parse(btn.dataset.resistencias || "[]");
      const imunidades   = JSON.parse(btn.dataset.imunidades   || "[]");
      const isCritico    = btn.dataset.critico === "1";

      const token = canvas.tokens.get(tokenId);
      if (!token) return;

      // Pega última rolagem de dano (sem d20)
      const msgDano = game.messages.contents
        .slice().reverse()
        .find(m => m.rolls?.length && !m.rolls.some(r => r.formula?.includes("d20")));

      if (!msgDano) return ui.notifications.warn("Nenhuma rolagem de dano encontrada!");

      let dano = msgDano.rolls.reduce((t, r) => t + (r.total ?? 0), 0);

      // Crítico: dobra o dano
      if (isCritico) dano *= 2;

      // Metade (resistência manual)
      if (metade) dano = Math.floor(dano / 2);

      // Detectar tipo de dano pelo texto da mensagem
      const texto = ((msgDano.flavor ?? "") + " " + (msgDano.content ?? "")).toLowerCase();
      const tipos = ["corte","perfuracao","perfuração","impacto","fogo","frio",
                     "eletricidade","acido","ácido","sonico","sônico","negativo","positivo","mental"];
      const tipo = tipos.find(t => texto.includes(t)) ?? null;

      // Imunidade
      if (tipo && imunidades.map(i => i.toLowerCase()).includes(tipo)) {
        return ChatMessage.create({
          content: `🛡️ <b>${token.name}</b> é <b>imune a ${tipo}</b>! Dano ignorado.`
        });
      }

      // Resistência (metade)
      let notaRes = "";
      if (tipo && resistencias.map(r => r.toLowerCase()).includes(tipo)) {
        const antes = dano;
        dano = Math.floor(dano / 2);
        notaRes = ` (resistência: ${antes}→${dano})`;
      }

      // Redução de Dano
      let notaRD = "";
      if (rd > 0) {
        const antes = dano;
        dano = Math.max(0, dano - rd);
        notaRD = ` (RD ${rd}: ${antes}→${dano})`;
      }

      if (dano <= 0) {
        return ChatMessage.create({
          content: `🛡️ <b>${token.name}</b> absorveu todo o dano${notaRD}.`
        });
      }

      // Aplicar no PV
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

      // Desabilitar botões após aplicar
      btn.closest(".t20-dano-btns")?.querySelectorAll("button")
        .forEach(b => { b.disabled = true; b.style.opacity = "0.5"; });
    };

    html[0].querySelectorAll(".t20-aplicar").forEach(btn =>
      btn.addEventListener("click", () => aplicar(btn, false))
    );
    html[0].querySelectorAll(".t20-metade").forEach(btn =>
      btn.addEventListener("click", () => aplicar(btn, true))
    );
  });
});
