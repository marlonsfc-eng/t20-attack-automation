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
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="t20-salvar"
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
          style="flex:2;padding:6px 4px;border-radius:4px;cursor:pointer;font-size:0.82em;
            background:linear-gradient(135deg,#1a4a1a,#2a6a2a);
            border:1px solid #3a8a3a;color:#fff;font-weight:bold">
          🎲 ${salvLabel}
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
          title="Escolher atributo, bônus e habilidades"
          style="flex:1;padding:6px 4px;border-radius:4px;cursor:pointer;font-size:0.82em;
            background:linear-gradient(135deg,#3a2a1a,#5a3a1a);
            border:1px solid #8a5a2a;color:#fff;font-weight:bold">
          ⚙️ Modificador
        </button>
      </div>
    </div>`;

  await ChatMessage.create({ content: html });
}

async function rolarSalvamento(btn) {
  const salvPericia = btn.dataset.salvPericia;
  const salvLabel   = btn.dataset.salvLabel;
  // Busca o input de CD subindo até o card inteiro (.t20-card ou a mensagem)
  const card        = btn.closest(".t20-card") ?? btn.closest(".message-content") ?? btn.parentElement;
  const cdInput     = card?.querySelector(".t20-cd-input");
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
  const _pRaw    = pericias[salvPericia];
  // T20 às vezes serializa a perícia como string JSON — faz o parse se necessário
  const pericia  = typeof _pRaw === "string" ? JSON.parse(_pRaw) : (_pRaw ?? {});
  const bonus    = pericia?.total ?? pericia?.value ?? pericia?.mod ?? 0;

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
  const cd              = parseInt(btn.dataset.cd);
  const nomeItem        = btn.dataset.item;
  const danoBase        = parseInt(btn.dataset.dano) || 0;
  const tipoDano        = (btn.dataset.tipoDano ?? "").toLowerCase();
  const salvPericiaBase = btn.dataset.salvPericia ?? "refl";
  const condicoesFalhar = (btn.dataset.condicoesFalhar ?? "").split(",").filter(Boolean);
  const condicoesPassar = (btn.dataset.condicoesPassar ?? "").split(",").filter(Boolean);

  const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
  if (!actor) return ui.notifications.warn("Selecione seu token antes de rolar!");

  // Bônus de perícias de salvamento
  const pericias = actor.system?.pericias ?? {};
  const _parsePer = (k) => { const r = pericias[k]; return typeof r === "string" ? JSON.parse(r) : (r ?? {}); };
  const bRefl = _parsePer("refl")?.value ?? 0;
  const bFort = _parsePer("fort")?.value ?? 0;
  const bVont = _parsePer("vont")?.value ?? 0;
  const labelPericia = { refl: "Reflexos", fort: "Fortitude", vont: "Vontade" };

  // ── Coleta habilidades relevantes dos itens E da ficha do personagem ──
  const PALAVRAS_CHAVE = [
    "reflexos", "fortitude", "vontade", "salvamento", "resistência",
    "evasão", "resistir", "teste de", "bônus em", "bonus em",
    "resistencia a", "resistência a",
  ];

  // Padrão genérico para extrair "resistência a X +N" de texto corrido
  // Ex: "resistência a magia +5", "resistência a medo +5"
  const REGEX_RESIST_TEXTO = /resistên?cia\s+a\s+([\w\s]+?)\s*[+](\d+)/gi;

  const habilidades = [];

  // 1) Itens do ator
  for (const item of actor.items) {
    const nome = item.name ?? "";
    const desc = (item.system?.description?.value ?? "").replace(/<[^>]+>/g, " ").toLowerCase();
    const relevante = PALAVRAS_CHAVE.some(p => desc.includes(p) || nome.toLowerCase().includes(p));
    if (!relevante) continue;

    const matchBonus = desc.match(/[+]\s*(\d+)\s*(?:em|nos?|nos?\s+testes?|de bônus)/i);
    const bonusSugerido = matchBonus ? parseInt(matchBonus[1]) : null;
    const eEvasaoApr  = /evasão aprimorada/i.test(nome) || /evasão aprimorada/i.test(desc);
    const eEvasaoSimp = !eEvasaoApr && (/evasão/i.test(nome) || /evasão/i.test(desc));

    habilidades.push({
      id:   item.id,
      nome,
      bonus: bonusSugerido,
      evasaoAprimorada: eEvasaoApr,
      evasaoSimples:    eEvasaoSimp,
    });
  }

  // 2) Texto corrido da ficha (detalhes/biografia — onde NPCs têm seus traços)
  //    Busca campos comuns do sistema T20
  const camposTexto = [
    actor.system?.details?.biography?.value ?? "",
    actor.system?.details?.notes?.value     ?? "",
    actor.system?.details?.appearance?.value ?? "",
    actor.system?.attributes?.resistencias?.value ?? "",
    // Alguns sistemas guardam em "tracos" como texto
    actor.system?.tracos?.especiais?.value ?? "",
  ];
  const textoFicha = camposTexto
    .join(" ")
    .replace(/<[^>]+>/g, " ");

  // Também verifica o próprio nome + valor na linha de detalhes principais
  // (ex: "Fort: +21, Refl: +8, Vont: +15, imunidade a Confuso, resistência a magia +5")
  // Tenta extrair direto dos campos de atributo estruturados se existirem
  const resistTexto = textoFicha + " " + (actor.system?.details?.source ?? "");

  let m;
  REGEX_RESIST_TEXTO.lastIndex = 0;
  const vistas = new Set();
  while ((m = REGEX_RESIST_TEXTO.exec(resistTexto)) !== null) {
    const tipoResist = m[1].trim().toLowerCase();
    const valorResist = parseInt(m[2]);
    const chave = `resist_${tipoResist}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);

    // Mapeia tipo de resistência → qual perícia de salvamento é relevante
    // "resistência a magia" → Vontade/Fortitude/Reflexos (genérico — bônus em todos)
    // "resistência a medo"  → Vontade
    // Deixamos como bônus genérico; o jogador pode ajustar o atributo no select
    habilidades.push({
      id:   chave,
      nome: `Resistência a ${m[1].trim()} (+${valorResist})`,
      bonus: valorResist,
      evasaoAprimorada: false,
      evasaoSimples:    false,
      // Sugestão de perícia para auto-selecionar
      periciaAssociada: tipoResist.includes("medo") || tipoResist.includes("encantamento")
        ? "vont"
        : tipoResist.includes("veneno") || tipoResist.includes("doença")
          ? "fort"
          : null, // null = sem sugestão, fica com o padrão do efeito
    });
  }

  // Monta opções de habilidades para o select
  const opcoesHabilidades = habilidades.length > 0
    ? habilidades.map(h => {
        let label = h.nome;
        if (h.evasaoAprimorada)   label += " — Evasão Aprimorada (÷4/÷2)";
        else if (h.evasaoSimples)  label += " — Evasão Simples (sem dano/total)";
        // bônus já aparece no nome para resistências de texto; só adiciona para itens
        else if (h.bonus !== null && !h.id.startsWith("resist_")) label += ` — +${h.bonus} bônus`;
        return `<option value="${h.id}"
          data-bonus="${h.bonus ?? 0}"
          data-evasao-apr="${h.evasaoAprimorada ? 1 : 0}"
          data-evasao-simp="${h.evasaoSimples ? 1 : 0}"
          data-pericia="${h.periciaAssociada ?? ""}">
          ${label}
        </option>`;
      }).join("")
    : `<option value="" disabled>Nenhuma habilidade encontrada</option>`;

  const conteudo = `
    <div style="display:grid;gap:12px;padding:6px;font-family:'Crimson Text',serif">

      <div>
        <label style="font-weight:bold;display:block;margin-bottom:4px;font-size:0.9em;text-transform:uppercase;letter-spacing:0.04em">
          Atributo de salvamento
        </label>
        <select id="t20-mod-pericia" style="width:100%;padding:5px;border-radius:4px">
          <option value="refl" ${salvPericiaBase === "refl" ? "selected" : ""}>Reflexos (+${bRefl})</option>
          <option value="fort" ${salvPericiaBase === "fort" ? "selected" : ""}>Fortitude (+${bFort})</option>
          <option value="vont" ${salvPericiaBase === "vont" ? "selected" : ""}>Vontade (+${bVont})</option>
        </select>
      </div>

      <div>
        <label style="font-weight:bold;display:block;margin-bottom:4px;font-size:0.9em;text-transform:uppercase;letter-spacing:0.04em">
          Bônus adicional
        </label>
        <input id="t20-mod-bonus" type="number" value="0"
          style="width:100%;padding:5px;border-radius:4px;text-align:center"/>
      </div>

      <div>
        <label style="font-weight:bold;display:block;margin-bottom:4px;font-size:0.9em;text-transform:uppercase;letter-spacing:0.04em">
          Habilidade especial
        </label>
        <select id="t20-mod-habilidade" style="width:100%;padding:5px;border-radius:4px">
          <option value="" data-bonus="0" data-evasao-apr="0" data-evasao-simp="0">
            — Nenhuma —
          </option>
          ${opcoesHabilidades}
        </select>
        <div id="t20-mod-preview" style="margin-top:5px;font-size:0.82em;color:#aaa;min-height:1.4em;font-style:italic"></div>
      </div>

    </div>`;

  const dlg = new Dialog({
    title: `⚙️ Modificador — ${nomeItem}`,
    content: conteudo,
    render: (html) => {
      html.find("#t20-mod-habilidade").on("change", function() {
        const opt      = this.options[this.selectedIndex];
        const bonus    = parseInt(opt.dataset.bonus) || 0;
        const evaApr   = opt.dataset.evasaoApr === "1";
        const evaSimp  = opt.dataset.evasaoSimp === "1";
        const pericia  = opt.dataset.pericia;
        const prev     = html.find("#t20-mod-preview");

        if (evaApr)        prev.text("Evasão Aprimorada: sucesso ÷4 | falha ÷2");
        else if (evaSimp)  prev.text("Evasão Simples: sucesso sem dano | falha total");
        else if (bonus)    prev.text("+" + bonus + " no teste de salvamento");
        else               prev.text("");

        // Auto-selecionar atributo sugerido pela resistência
        if (pericia) html.find("#t20-mod-pericia").val(pericia);
      });
    },
    buttons: {
      rolar: {
        label: "🎲 Rolar",
        callback: (html) => {
          const pericia = html.find("#t20-mod-pericia").val();
          const bonusManual = parseInt(html.find("#t20-mod-bonus").val()) || 0;

          // Lê habilidade selecionada
          const sel      = html.find("#t20-mod-habilidade")[0];
          const opt      = sel?.options[sel.selectedIndex];
          const bonusHab = parseInt(opt?.dataset?.bonus) || 0;
          const evaApr   = opt?.dataset?.evasaoApr === "1";
          const evaSimp  = opt?.dataset?.evasaoSimp === "1";

          // Evasão tem prioridade sobre bônus numérico
          const temPoder = evaApr;
          const evasaoSimples = evaSimp;
          const bonusTotal = bonusManual + (evaApr || evaSimp ? 0 : bonusHab);

          rolarSalvamentoCustom({
            actor, cd, nomeItem, danoBase, tipoDano,
            salvPericia: pericia,
            salvLabel:   labelPericia[pericia],
            bonusExtra:  bonusTotal,
            temPoder,
            evasaoSimples,
            condicoesFalhar,
            condicoesPassar,
          });
        }
      },
      cancelar: { label: "Cancelar" }
    },
    default: "rolar",
  });
  dlg.render(true);
}

async function rolarSalvamentoCustom({ actor, cd, nomeItem, danoBase, tipoDano,
    salvPericia, salvLabel, bonusExtra, temPoder, evasaoSimples = false, condicoesFalhar = [], condicoesPassar = [] }) {

  const pericias  = actor.system?.pericias ?? {};
  const _pRaw2    = pericias[salvPericia];
  const p         = typeof _pRaw2 === "string" ? JSON.parse(_pRaw2) : (_pRaw2 ?? {});
  const bonusBase = p?.total ?? p?.value ?? p?.mod ?? 0;
  const bonus     = bonusBase + bonusExtra;
  const bonusStr = bonusExtra !== 0 ? ` ${bonusExtra > 0 ? "+" : ""}${bonusExtra} custom` : "";

  console.log(`Arsenal T20 | rolarSalvamentoCustom | pericia=${salvPericia} bonusBase=${bonusBase} bonusExtra=${bonusExtra} total=${bonus} cd=${cd}`);
  const roll    = await new Roll(`1d20 + ${bonus}`).evaluate();
  const sucesso = roll.total >= cd;
  const cor     = sucesso ? "#27ae60" : "#e74c3c";
  const label   = sucesso ? "✅ SUCESSO!" : "❌ FALHOU!";

  const temEvasaoC = evasaoSimples;
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
