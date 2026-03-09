// hooks.js - Tormenta20 Attack Automation v1.6

Hooks.once("ready", () => {
  // Registrar configurações do módulo
  const MOD = "arsenal-t20";

  game.settings.register(MOD, "autoAtaque", {
    name: "Automação de Ataque",
    hint: "Detecta acerto, erro, crítico e erro natural. Exibe painel privado ao GM com DEF, PV e botões para aplicar dano com resistências.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MOD, "autoSalvamento", {
    name: "Testes de Resistência",
    hint: "Ao lançar magias/poderes com resistência, exibe card no chat com botões para jogadores rolarem o teste (CD calculado automaticamente).",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MOD, "autoCondicoes", {
    name: "Aplicar Condições Automaticamente",
    hint: "Ao falhar/passar num teste de resistência, aplica automaticamente as condições listadas na descrição da magia (ex: Fatigado, Apavorado).",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MOD, "mensagemPublica", {
    name: "Mensagem Pública de Ataque",
    hint: "Exibe mensagem no chat visível a todos os jogadores indicando acerto/erro, sem revelar DEF ou PV do alvo.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MOD, "danoAutoGM", {
    name: "Painel de Dano do GM",
    hint: "Exibe painel privado ao GM com DEF, PV, resistências do alvo e botões para aplicar dano com um clique.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  const ativas = [];
  if (game.settings.get(MOD, "autoAtaque"))      ativas.push("Ataque");
  if (game.settings.get(MOD, "autoSalvamento"))  ativas.push("Salvamento");
  if (game.settings.get(MOD, "autoCondicoes"))   ativas.push("Condições");

  console.log(`Arsenal T20 | v1.6 carregado! Ativas: ${ativas.join(", ") || "nenhuma"}`);
  if (game.user.isGM) ui.notifications.info("⚔️ Arsenal T20 ativo!");

});

// Helper para verificar configurações
function cfg(chave) {
  try { return game.settings.get("arsenal-t20", chave); }
  catch { return true; } // fallback: ativo por padrão
}

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
  if (!cfg("autoAtaque")) return;
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

  if (cfg("mensagemPublica")) await criarMensagemPublica(totalAtaque, dadosAlvos);

  if (game.user.isGM) {
    if (cfg("danoAutoGM")) await criarMensagemGM(totalAtaque, dadosAlvos, danoPorTipo, rollDano?.total ?? null);
  } else {
    game.socket.emit("module.arsenal-t20", {
      tipo: "atacou",
      totalAtaque, dadosAlvos,
      danoPorTipo,
      danoTotal: rollDano?.total ?? null
    });
  }
});

Hooks.once("ready", () => {
  game.socket.on("module.arsenal-t20", async (data) => {
    if (!game.user.isGM) return;
    if (data.tipo === "atacou") {
      if (cfg("danoAutoGM")) await criarMensagemGM(data.totalAtaque, data.dadosAlvos, data.danoPorTipo, data.danoTotal);
    }
    if (data.tipo === "aplicarCondicoes") {
      const actor = game.actors.get(data.actorId);
      if (actor) await aplicarCondicoes(actor, data.condicoes, data.nomeItem);
    }
  });
});

async function criarMensagemPublica(totalAtaque, dadosAlvos) {
  let html = `
    <div class="t20-card" style="background:linear-gradient(135deg,#1a1200,#2a1e00);border:1px solid #7a5a00;border-top:3px solid #c9a227;border-radius:6px;padding:10px;color:#e8d5b7;font-family:'Palatino Linotype',serif;">
      <div class="t20-card-titulo" style="color:#c9a227;font-family:'Cinzel',serif;font-weight:bold;margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid #3a2a00;">
        ⚔️ Ataque — Total: ${totalAtaque}
      </div>`;

  for (const a of dadosAlvos) {
    const cor = a.erroNatural ? "#888" : a.possivelCritico && a.acertou ? "#ff6b35" : a.acertou ? "#27ae60" : "#e74c3c";
    const label = a.erroNatural ? "💨 Erro Natural" : a.possivelCritico && a.acertou ? "⚔️ CRÍTICO!" : a.acertou ? "✅ Acertou!" : "❌ Errou";
    const classeRes = a.erroNatural ? "" : a.possivelCritico && a.acertou ? "critico" : a.acertou ? "acerto" : "erro";
    html += `
      <div class="t20-resultado ${classeRes}" style="border-left-color:${cor};">
        <span class="t20-nome">${a.nome}</span>
        <span style="color:${cor};font-weight:bold">${label}</span>
      </div>`;
  }
  html += `</div>`;
  await ChatMessage.create({ content: html });
}

async function criarMensagemGM(totalAtaque, dadosAlvos, danoPorTipo, danoTotal) {
  const temDano = danoPorTipo && Object.keys(danoPorTipo).length > 0;

  let html = `
    <div class="t20-card" style="background:linear-gradient(135deg,#0f0f1a,#1a1a2e);border:1px solid #2a2a5a;border-top:3px solid #9a7fd4;border-radius:6px;padding:12px;color:#e8d5b7;font-family:'Palatino Linotype',serif;">
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
  })
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
  if (!cfg("autoSalvamento")) return;
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

  // Detectar condições via IA
  const descricaoTexto = itemData?.description?.value ?? "";
  const condicoesIA = detectarCondicoesContexto(nomeItem, descricaoTexto, resistencia.txt ?? "");
  const condicoesAoFalhar = condicoesIA.aoFalhar ?? [];
  const condicoesAoPassar = condicoesIA.aoPassar ?? [];

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
    condicoesAoFalhar,
    condicoesAoPassar,
  });
});

async function criarCartaoSalvamento({ nomeItem, imgItem, nomeConjurador,
    salvLabel, salvPericia, salvAtributo, cd, efeitoSucesso, tipoDano, formulaDano, danoRolado,
    condicoesAoFalhar = [], condicoesAoPassar = [] }) {

  const html = `
    <div class="t20-card" style="background:linear-gradient(135deg,#0a1a0a,#0f2a1a);border:1px solid #1a4a1a;border-top:3px solid #27ae60;border-radius:6px;padding:12px;color:#e8d5b7;font-family:'Palatino Linotype',serif;">
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
        ${condicoesAoFalhar.length ? `<br>❌ Falha aplica: <b>${condicoesAoFalhar.map(id => CONFIG.statusEffects.find(e=>e.id===id)?.name ?? id).join(", ")}</b>` : ""}
        ${condicoesAoPassar.length ? `<br>✅ Sucesso aplica: <b>${condicoesAoPassar.map(id => CONFIG.statusEffects.find(e=>e.id===id)?.name ?? id).join(", ")}</b>` : ""}
      </div>
      <div style="display:flex;gap:4px;margin-top:6px">
        <button class="t20-salvar t20-btn-primario"
          data-salv-pericia="${salvPericia}"
          data-salv-label="${salvLabel}"
          data-cd="${cd}"
          data-item="${nomeItem}"
          data-dano="${danoRolado ?? 0}"
          data-tipo-dano="${tipoDano}"
          data-condicoes-falhar="${condicoesAoFalhar.join(',')}"
          data-condicoes-passar="${condicoesAoPassar.join(',')}"
          data-poder="0"
          data-evasao="0"
          title="Sucesso: ÷2 | Falha: total"
          style="flex:1;padding:5px 3px;border-radius:4px;cursor:pointer;font-size:0.78em;
            background:linear-gradient(135deg,#1a4a1a,#2a6a2a);
            border:1px solid #3a8a3a;color:#fff;font-weight:bold">
          🎲 ${salvLabel}
        </button>
        <button class="t20-salvar t20-btn-primario"
          data-salv-pericia="${salvPericia}"
          data-salv-label="${salvLabel}"
          data-cd="${cd}"
          data-item="${nomeItem}"
          data-dano="${danoRolado ?? 0}"
          data-tipo-dano="${tipoDano}"
          data-condicoes-falhar="${condicoesAoFalhar.join(',')}"
          data-condicoes-passar="${condicoesAoPassar.join(',')}"
          data-poder="0"
          data-evasao="1"
          title="Evasão Simples — Sucesso: sem dano | Falha: dano total"
          style="flex:1;padding:5px 3px;border-radius:4px;cursor:pointer;font-size:0.78em;
            background:linear-gradient(135deg,#2a3a1a,#3a5a1a);
            border:1px solid #5a8a2a;color:#fff;font-weight:bold">
          🌀 Evasão
        </button>
        <button class="t20-salvar t20-btn-primario"
          data-salv-pericia="${salvPericia}"
          data-salv-label="${salvLabel}"
          data-cd="${cd}"
          data-item="${nomeItem}"
          data-dano="${danoRolado ?? 0}"
          data-tipo-dano="${tipoDano}"
          data-condicoes-falhar="${condicoesAoFalhar.join(',')}"
          data-condicoes-passar="${condicoesAoPassar.join(',')}"
          data-poder="1"
          title="Com poder — Sucesso: ÷4 | Falha: ÷2"
          style="flex:1;padding:5px 3px;border-radius:4px;cursor:pointer;font-size:0.78em;
            background:linear-gradient(135deg,#1a3a4a,#1a4a6a);
            border:1px solid #2a6a8a;color:#fff;font-weight:bold">
          🛡️ Resistência
        </button>
        <button class="t20-custom"
          data-salv-pericia="${salvPericia}"
          data-salv-label="${salvLabel}"
          data-cd="${cd}"
          data-item="${nomeItem}"
          data-dano="${danoRolado ?? 0}"
          data-tipo-dano="${tipoDano}"
          data-condicoes-falhar="${condicoesAoFalhar.join(',')}"
          data-condicoes-passar="${condicoesAoPassar.join(',')}"
          title="Escolher atributo e bônus manualmente"
          style="flex:1;padding:5px 3px;border-radius:4px;cursor:pointer;font-size:0.78em;
            background:linear-gradient(135deg,#3a2a1a,#5a3a1a);
            border:1px solid #8a5a2a;color:#fff;font-weight:bold">
          ⚙️ Custom
        </button>
      </div>
    </div>`;

  await ChatMessage.create({ content: html });
}

async function rolarSalvamento(btn) {
  const salvPericia = btn.dataset.salvPericia;
  const salvLabel   = btn.dataset.salvLabel;
  const cdInput     = btn.closest("div")?.querySelector(".t20-cd-input");
  const cd          = cdInput ? parseInt(cdInput.value) : parseInt(btn.dataset.cd);
  const nomeItem    = btn.dataset.item;
  const danoBase    = parseInt(btn.dataset.dano) || 0;
  const tipoDano    = (btn.dataset.tipoDano ?? "").toLowerCase();
  const temPoder    = btn.dataset.poder === "1";
  const condicoesFalhar = (btn.dataset.condicoesFalhar ?? "").split(",").filter(Boolean);
  const condicoesPassar = (btn.dataset.condicoesPassar ?? "").split(",").filter(Boolean);

  const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
  if (!actor) return ui.notifications.warn("Selecione seu token antes de rolar!");

  const pericias = actor.system?.pericias ?? {};
  const pericia  = pericias[salvPericia];
  const bonus    = pericia?.value ?? 0;

  const roll    = await new Roll(`1d20 + ${bonus}`).evaluate();
  const sucesso = roll.total >= cd;
  const cor     = sucesso ? "#27ae60" : "#e74c3c";
  const label   = sucesso ? "✅ SUCESSO!" : "❌ FALHOU!";

  // Com poder (Evasão Aprimorada): sucesso = ÷4, falha = ÷2
  // Evasão simples: sucesso = 0, falha = total
  // Sem evasão: sucesso = ÷2, falha = total
  const temEvasao = btn.dataset.evasao === "1";
  let danoFinal = temPoder
    ? (sucesso ? Math.floor(danoBase / 4) : Math.floor(danoBase / 2))
    : temEvasao
      ? (sucesso ? 0 : danoBase)
      : (sucesso ? Math.floor(danoBase / 2) : danoBase);
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

      const prefixo = temPoder
        ? (sucesso
            ? `✅ Sucesso + Evasão Aprimorada! Dano: ${danoBase}÷4 = ${Math.floor(danoBase/4)}`
            : `❌ Falhou + Evasão Aprimorada! Dano: ${danoBase}÷2 = ${Math.floor(danoBase/2)}`)
        : temEvasao
          ? (sucesso
              ? `🌀 Evasão! Sem dano.`
              : `❌ Falhou! Dano total: ${danoBase}`)
          : (sucesso
              ? `✅ Sucesso! Dano: ${danoBase}÷2 = ${Math.floor(danoBase/2)}`
              : `❌ Falhou! Dano total: ${danoBase}`);
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

  // Mensagem da rolagem (limpa, só o resultado do dado)
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<b>${salvLabel}</b> contra <i>${nomeItem}</i> (CD ${cd})`,
  });

  // Mensagem separada com resultado e dano aplicado
  const msgConteudo = `
    <div style="border-left:4px solid ${cor};padding:6px 10px;border-radius:0 4px 4px 0">
      <div style="font-weight:bold;font-size:1.05em;color:${cor};margin-bottom:4px">
        ${label} — ${actor.name}
      </div>
      <div style="font-size:0.88em">
        ${notaDano}
      </div>
    </div>`;

  await ChatMessage.create({
    content: msgConteudo,
    speaker: ChatMessage.getSpeaker({ actor }),
  });

  // Aplicar condições baseado no resultado
  const condicoesAplicar = sucesso ? condicoesPassar : condicoesFalhar;
  if (cfg("autoCondicoes") && condicoesAplicar.length) {
    if (game.user.isGM) {
      await aplicarCondicoes(actor, condicoesAplicar, nomeItem);
    } else {
      game.socket.emit("module.arsenal-t20", {
        tipo: "aplicarCondicoes",
        actorId: actor.id,
        condicoes: condicoesAplicar,
        nomeItem,
      });
    }
  }

  // NÃO desabilita o botão — outros jogadores podem precisar rolar também
}

// Listener global persistente para botões de salvamento
Hooks.on("renderChatMessage", (message, html) => {
  html[0].querySelectorAll(".t20-salvar").forEach(btn => {
    if (btn.dataset.listenerAdded) return;
    btn.dataset.listenerAdded = "1";
    btn.addEventListener("click", () => rolarSalvamento(btn));
  });
  html[0].querySelectorAll(".t20-custom").forEach(btn => {
    if (btn.dataset.listenerAdded) return;
    btn.dataset.listenerAdded = "1";
    btn.addEventListener("click", () => abrirDialogCustom(btn));
  });
});

async function abrirDialogCustom(btn) {
  const cd       = parseInt(btn.dataset.cd);
  const nomeItem = btn.dataset.item;
  const danoBase  = parseInt(btn.dataset.dano) || 0;
  const tipoDano  = (btn.dataset.tipoDano ?? "").toLowerCase();
  const condicoesFalhar = (btn.dataset.condicoesFalhar ?? "").split(",").filter(Boolean);
  const condicoesPassar = (btn.dataset.condicoesPassar ?? "").split(",").filter(Boolean);

  const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
  if (!actor) return ui.notifications.warn("Selecione seu token antes de rolar!");

  // Calcular bônus de cada perícia de salvamento do personagem
  const pericias = actor.system?.pericias ?? {};
  const bRefl = pericias?.refl?.value ?? 0;
  const bFort = pericias?.fort?.value ?? 0;
  const bVont = pericias?.vont?.value ?? 0;

  const conteudo = `
    <div style="display:grid;gap:10px;padding:4px">
      <div>
        <label style="font-weight:bold;display:block;margin-bottom:4px">Atributo de salvamento:</label>
        <select id="t20-custom-pericia" style="width:100%;padding:4px;border-radius:4px">
          <option value="refl">Reflexos (+${bRefl})</option>
          <option value="fort">Fortitude (+${bFort})</option>
          <option value="vont">Vontade (+${bVont})</option>
        </select>
      </div>
      <div>
        <label style="font-weight:bold;display:block;margin-bottom:4px">Bônus adicional:</label>
        <input id="t20-custom-bonus" type="number" value="0"
          style="width:100%;padding:4px;border-radius:4px;text-align:center"/>
      </div>
      <div>
        <label style="font-weight:bold;display:block;margin-bottom:4px">Redução de dano:</label>
        <select id="t20-custom-poder" style="width:100%;padding:4px;border-radius:4px">
          <option value="0">Normal (sucesso ÷2 | falha total)</option>
          <option value="1">Com poder (sucesso ÷4 | falha ÷2)</option>
        </select>
      </div>
    </div>`;

  new Dialog({
    title: `⚙️ Salvamento Custom — ${nomeItem}`,
    content: conteudo,
    buttons: {
      rolar: {
        label: "🎲 Rolar",
        callback: (html) => {
          const pericia  = html.find("#t20-custom-pericia").val();
          const bonus    = parseInt(html.find("#t20-custom-bonus").val()) || 0;
          const temPoder = html.find("#t20-custom-poder").val() === "1";
          const labels   = { refl: "Reflexos", fort: "Fortitude", vont: "Vontade" };

          rolarSalvamentoCustom({
            actor, cd, nomeItem, danoBase, tipoDano,
            salvPericia: pericia,
            salvLabel: labels[pericia],
            bonusExtra: bonus,
            temPoder,
            condicoesFalhar,
            condicoesPassar,
          });
        }
      },
      cancelar: { label: "Cancelar" }
    },
    default: "rolar",
  }).render(true);
}

async function rolarSalvamentoCustom({ actor, cd, nomeItem, danoBase, tipoDano,
    salvPericia, salvLabel, bonusExtra, temPoder, condicoesFalhar = [], condicoesPassar = [] }) {

  const pericias = actor.system?.pericias ?? {};
  const bonus    = (pericias[salvPericia]?.value ?? 0) + bonusExtra;
  const bonusStr = bonusExtra !== 0 ? ` ${bonusExtra > 0 ? "+" : ""}${bonusExtra} custom` : "";

  const roll    = await new Roll(`1d20 + ${bonus}`).evaluate();
  const sucesso = roll.total >= cd;
  const cor     = sucesso ? "#27ae60" : "#e74c3c";
  const label   = sucesso ? "✅ SUCESSO!" : "❌ FALHOU!";

  const temEvasaoC = btn?.dataset?.evasao === "1";
  let danoFinal = temPoder
    ? (sucesso ? Math.floor(danoBase / 4) : Math.floor(danoBase / 2))
    : temEvasaoC
      ? (sucesso ? 0 : danoBase)
      : (sucesso ? Math.floor(danoBase / 2) : danoBase);

  let notaDano = "";

  if (danoBase > 0) {
    const tracos   = actor.system?.tracos?.resistencias ?? {};
    const tipoNorm = tipoDano || null;
    const traco    = tipoNorm ? tracos?.[tipoNorm] : null;

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

      const prefixo = temPoder
        ? (sucesso ? `✅ Sucesso+Evasão Apr.! ${danoBase}÷4=${Math.floor(danoBase/4)}` : `❌ Falhou+Evasão Apr.! ${danoBase}÷2=${Math.floor(danoBase/2)}`)
        : temEvasaoC
          ? (sucesso ? `🌀 Evasão! Sem dano.` : `❌ Falhou! Dano total: ${danoBase}`)
          : (sucesso ? `✅ Sucesso! ${danoBase}÷2=${Math.floor(danoBase/2)}` : `❌ Falhou! Dano total: ${danoBase}`);
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
    flavor: `<b>${salvLabel}${bonusStr}</b> contra <i>${nomeItem}</i> (CD ${cd})`,
  });

  await ChatMessage.create({
    content: `<div style="border-left:4px solid ${cor};padding:6px 10px;border-radius:0 4px 4px 0">
      <div style="font-weight:bold;color:${cor}">${label} — ${actor.name}</div>
      <div style="font-size:0.88em">${notaDano}</div>
    </div>`,
    speaker: ChatMessage.getSpeaker({ actor }),
  });

  const condicoesAplicar2 = sucesso ? condicoesPassar : condicoesFalhar;
  if (cfg("autoCondicoes") && condicoesAplicar2.length) {
    if (game.user.isGM) {
      await aplicarCondicoes(actor, condicoesAplicar2, nomeItem);
    } else {
      game.socket.emit("module.arsenal-t20", {
        tipo: "aplicarCondicoes",
        actorId: actor.id,
        condicoes: condicoesAplicar2,
        nomeItem,
      });
    }
  }
}

// ============================================================
// CONDIÇÕES AUTOMÁTICAS
// ============================================================

// Mapa de texto → ID da condição do T20
const CONDICOES_MAP = {
  "em chamas":     "emchamas",
  "chamas":        "emchamas",
  "abalado":       "abalado",
  "agarrado":      "agarrado",
  "alquebrado":    "alquebrado",
  "apavorado":     "apavorado",
  "atordoado":     "atordoado",
  "caído":         "caido",
  "caido":         "caido",
  "cego":          "cego",
  "confuso":       "confuso",
  "debilitado":    "debilitado",
  "desprevenido":  "desprevenido",
  "doente":        "doente",
  "enfeitiçado":   "enfeiticado",
  "enfeiticado":   "enfeiticado",
  "enjoado":       "enjoado",
  "enredado":      "enredado",
  "envenenado":    "envenenado",
  "esmorecido":    "esmorecido",
  "exausto":       "exausto",
  "fascinado":     "fascinado",
  "fatigado":      "fatigado",
  "fraco":         "fraco",
  "frustrado":     "frustrado",
  "imóvel":        "imovel",
  "imovel":        "imovel",
  "inconsciente":  "inconsciente",
  "indefeso":      "indefeso",
  "invisível":     "invisivel",
  "invisivel":     "invisivel",
  "lento":         "lento",
  "morto":         "morto",
  "ofuscado":      "ofuscado",
  "paralisado":    "paralisado",
  "pasmo":         "pasmo",
  "petrificado":   "petrificado",
  "sangrando":     "sangrando",
  "surdo":         "surdo",
  "surpreendido":  "surpreendido",
  "vulnerável":    "vulneravel",
  "vulneravel":    "vulneravel",
  "sobrecarregado":"sobrecarregado",
};

// Detecta condições com contexto — distingue "aplica X" de "não fica X" ou "como X"
function detectarCondicoesContexto(nomeItem, descricao, txtResistencia) {
  // Limpar HTML, links @uuid[...]{texto} → manter só o texto interno, e normalizar espaços
  const texto = descricao
    .replace(/@uuid\[[^\]]*\]\{([^}]*)\}/gi, "$1")  // @uuid[...]{abalado} → abalado
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();

  const aoFalhar = new Set();
  const aoPassar = new Set();

  // Padrões de negação — se a condição aparece aqui, IGNORAR
  const negacoes = [
    /não.{0,20}(fica|ficará|aplica|causa|recebe)/,
    /sem.{0,10}(ficar|aplicar)/,
    /evita.{0,20}/,
    /impede.{0,20}/,
    /como se.{0,30}/,        // "como se estivesse X" = referência
    /não.{0,5}irá/,
    /não acumul/,
    /deixá-lo/,              // "não irá deixá-lo exausto"
  ];

  // Detectar blocos de texto separados por "se falhar" / "se passar"
  // Padrões: "se falhar... fica X", "falhar na resistência... X", "se passar... Y"
  // Captura tudo após o marcador de falha/sucesso até o fim do trecho relevante
  const blocoFalha   = texto.match(/(?:se falhar|falhar na resist[eê]ncia|ao falhar|em caso de falha)([^]*?)(?=se passar|se resistir|passar na resist|$)/i)?.[1]?.trim() ?? "";
  const blocoSucesso = texto.match(/(?:se passar|passar na resist[eê]ncia|ao passar|em caso de sucesso|se resistir)([^]*?)(?=se falhar|ao falhar|$)/i)?.[1]?.trim() ?? "";

  // Se não achou blocos separados, tudo vai para aoFalhar (comportamento padrão)
  const textoPrincipal = blocoFalha || texto;

  for (const [chave, id] of Object.entries(CONDICOES_MAP)) {
    // Verificar negações — se a condição aparece num contexto negativo, pular
    const regexCondicao = new RegExp(`.{0,40}${chave}.{0,40}`, "gi");
    const ocorrencias = [...texto.matchAll(regexCondicao)].map(m => m[0]);
    const eNegada = ocorrencias.some(trecho =>
      negacoes.some(neg => neg.test(trecho))
    );
    if (eNegada) continue;

    // Verificar no bloco de falha
    if (blocoFalha && blocoFalha.includes(chave)) {
      aoFalhar.add(id);
    }
    // Verificar no bloco de sucesso
    if (blocoSucesso && blocoSucesso.includes(chave)) {
      aoPassar.add(id);
    }
    // Se não há blocos separados mas a condição está no texto geral
    if (!blocoFalha && !blocoSucesso && texto.includes(chave)) {
      aoFalhar.add(id);
    }
  }

  // Também verificar no txt de resistência (ex: "Reflexos reduz à metade e evita a condição")
  // Se diz "evita a condição", sucesso não aplica nada (já é o padrão)

  return {
    aoFalhar: [...aoFalhar],
    aoPassar: [...aoPassar],
  };
}

// Aplica condições em um ator (requer permissão de GM ou owner)
async function aplicarCondicoes(actor, condicoes, nomeItem) {
  if (!condicoes.length) return;
  for (const id of condicoes) {
    const jaAtiva = actor.statuses?.has(id);
    if (!jaAtiva) {
      await actor.toggleStatusEffect(id);
    }
  }
  const nomes = condicoes.map(id =>
    CONFIG.statusEffects.find(e => e.id === id)?.name ?? id
  ).join(", ");

  ChatMessage.create({
    content: `<div style="border-left:4px solid #9b59b6;padding:6px 10px;border-radius:0 4px 4px 0">
      <b>🔮 ${actor.name}</b> recebeu a condição: <b>${nomes}</b>
      <div style="font-size:0.85em;color:#888">por: ${nomeItem}</div>
    </div>`
  });
}

// ============================================================
// CURA ACELERADA
// ============================================================

// Estado em memória: { actorId: { valor, ativo } }
const curaAceleradaAtiva = {};

// ── Detecta "cura acelerada" em mensagens de chat ──────────
Hooks.on("createChatMessage", async (message) => {
  if (!game.user.isGM) return;

  const texto = message.content?.toLowerCase() ?? "";
  const flags  = message.flags?.tormenta20 ?? {};
  const itemData = flags.itemData ?? null;

  // Checa texto da mensagem ou descrição do item
  const descItem = (itemData?.description?.value ?? "").toLowerCase();
  const temCuraAcelerada = /cura\s+acelerada/.test(texto) || /cura\s+acelerada/.test(descItem);
  if (!temCuraAcelerada) return;

  // Tenta extrair valor do texto (ex: "cura acelerada 5" ou "cura acelerada (10)")
  const matchValor = (texto + " " + descItem).match(/cura\s+acelerada[\s:(]+(\d+)/i);
  const valorSugerido = matchValor ? parseInt(matchValor[1]) : "";

  // Identifica o ator que usou
  const speaker = message.speaker;
  const actor = speaker.token
    ? game.scenes.active?.tokens.get(speaker.token)?.actor
    : game.actors.get(speaker.actor);
  if (!actor) return;

  // Abre prompt para confirmar/definir o valor
  const resultado = await Dialog.prompt({
    title: "⚕️ Cura Acelerada",
    content: `
      <div style="padding:10px;font-family:'Crimson Text',serif">
        <p style="margin-bottom:8px">
          <b style="color:#27ae60">${actor.name}</b> usou um poder com Cura Acelerada.<br>
          Defina quantos PV serão recuperados por rodada:
        </p>
        <div style="display:flex;align-items:center;gap:10px">
          <label style="font-weight:bold">PV por rodada:</label>
          <input id="ca-valor" type="number" min="1" value="${valorSugerido}"
            style="width:70px;padding:4px 8px;background:#1a1a26;border:1px solid #3a3a50;
              color:#e8d5b7;border-radius:4px;font-size:1.1em;text-align:center">
        </div>
      </div>`,
    label: "✅ Ativar",
    callback: (html) => parseInt(html.find("#ca-valor").val()) || 0,
  });

  if (!resultado || resultado <= 0) return;

  curaAceleradaAtiva[actor.id] = { valor: resultado, ativo: true };
  ui.notifications.info(`⚕️ Cura Acelerada ${resultado} ativada para ${actor.name}`);

  // Posta aviso no chat
  ChatMessage.create({
    content: `
      <div style="background:#0a1a0a;border:1px solid #1a5a1a;border-top:3px solid #27ae60;
        border-radius:6px;padding:10px;font-family:'Crimson Text',serif;color:#d4e8d0">
        <div style="color:#27ae60;font-family:'Cinzel',serif;font-weight:bold;
          margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #1a4a1a">
          ⚕️ Cura Acelerada Ativa
        </div>
        <b>${actor.name}</b> recupera <b style="color:#27ae60">${resultado} PV</b> no início de cada rodada.
      </div>`,
    speaker: ChatMessage.getSpeaker(),
  });
});

// ── Aplica cura ao início de cada rodada ──────────────────
Hooks.on("updateCombat", async (combat, update) => {
  // Só dispara na virada de rodada (round aumentou) e no turno 0
  if (!game.user.isGM) return;
  if (!("round" in update)) return;
  if (combat.turn !== 0 && update.turn !== 0) return;

  for (const [actorId, estado] of Object.entries(curaAceleradaAtiva)) {
    if (!estado.ativo) continue;

    const actor = game.actors.get(actorId)
      ?? game.scenes.active?.tokens.find(t => t.actorId === actorId)?.actor;
    if (!actor) continue;

    const pvAtual = actor.system.attributes.pv.value;
    const pvMax   = actor.system.attributes.pv.max;
    if (pvAtual >= pvMax) continue; // já está cheio

    const pvNovo = Math.min(pvMax, pvAtual + estado.valor);
    const curado = pvNovo - pvAtual;

    await actor.update({ "system.attributes.pv.value": pvNovo });

    ChatMessage.create({
      content: `
        <div style="background:#0a1a0a;border:1px solid #1a4a1a;border-left:3px solid #27ae60;
          border-radius:0 4px 4px 0;padding:6px 10px;font-family:'Crimson Text',serif;color:#d4e8d0;font-size:0.9em">
          ⚕️ <b>${actor.name}</b> — Cura Acelerada: 
          <b style="color:#27ae60">+${curado} PV</b>
          <span style="color:#6a8a6a;font-size:0.85em">(${pvNovo}/${pvMax})</span>
        </div>`,
      speaker: ChatMessage.getSpeaker({ actor }),
      whisper: [game.users.find(u => u.isGM)?.id].filter(Boolean),
    });
  }
});

// ── Detecta cura acelerada em fichas de NPC ───────────────
Hooks.on("renderActorSheet", (sheet, html) => {
  if (!game.user.isGM) return;
  const actor = sheet.actor;
  if (actor.type !== "npc" && actor.type !== "character") return;

  // Busca em todos os itens do ator
  let valorEncontrado = 0;
  for (const item of actor.items) {
    const desc = (item.system?.description?.value ?? "").toLowerCase();
    const match = desc.match(/cura\s+acelerada[\s:(]+(\d+)/i);
    if (match) {
      valorEncontrado = Math.max(valorEncontrado, parseInt(match[1]));
    }
  }
  // Também busca na descrição do próprio ator
  const descAtor = (actor.system?.details?.biography?.value ?? "").toLowerCase();
  const matchAtor = descAtor.match(/cura\s+acelerada[\s:(]+(\d+)/i);
  if (matchAtor) valorEncontrado = Math.max(valorEncontrado, parseInt(matchAtor[1]));

  if (!valorEncontrado) return;

  const estado = curaAceleradaAtiva[actor.id];
  const ativo  = estado?.ativo ?? false;

  // Injeta botão no header da ficha
  const btnLabel = ativo
    ? `⚕️ Cura Acelerada ${valorEncontrado} — ATIVA`
    : `⚕️ Cura Acelerada ${valorEncontrado} — desativada`;
  const btnStyle = ativo
    ? "background:#1a5a1a;border:1px solid #27ae60;color:#27ae60;"
    : "background:#1a1a26;border:1px solid #3a3a50;color:#6a6a8a;";

  const btnHtml = $(`
    <button class="arsenal-ca-toggle"
      style="${btnStyle}border-radius:4px;padding:3px 10px;cursor:pointer;
        font-family:'Cinzel',serif;font-size:0.78em;font-weight:bold;
        margin:4px 6px;transition:all 0.2s;width:calc(100% - 12px)">
      ${btnLabel}
    </button>`);

  btnHtml.on("click", (e) => {
    e.preventDefault();
    if (curaAceleradaAtiva[actor.id]?.ativo) {
      curaAceleradaAtiva[actor.id].ativo = false;
      ui.notifications.info(`⚕️ Cura Acelerada desativada para ${actor.name}`);
    } else {
      curaAceleradaAtiva[actor.id] = { valor: valorEncontrado, ativo: true };
      ui.notifications.info(`⚕️ Cura Acelerada ${valorEncontrado} ativada para ${actor.name}`);
    }
    sheet.render(); // re-renderiza para atualizar o botão
  });

  // Insere logo após o header da ficha
  const header = html.find(".sheet-header");
  if (header.length) {
    header.after(btnHtml);
  } else {
    html.find(".window-content").prepend(btnHtml);
  }
});
