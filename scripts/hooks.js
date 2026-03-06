// hooks.js - Tormenta20 Attack Automation v1.5 (Foundry VTT 13 / Tormenta20 1.5.015)
// - Suporta múltiplos tipos de dano no mesmo roll (ex: 4d10[corte] + 12[corte] + 3d6[fogo])
// - Aplica imunidade / vulnerabilidade / RD específica por tipo
// - Aplica RD geral UMA vez no total final (opção escolhida)
// - Envia detalhamento para o GM via socket (serializável)

Hooks.once("ready", () => {
  console.log("T20 Attack Automation | v1.5 carregado!");
  ui.notifications.info("⚔️ T20 Attack Automation ativo!");
});

/** Normaliza nomes de tipos para bater com as chaves em system.tracos.resistencias */
function normalizarTipo(tipo) {
  if (!tipo) return null;
  const t = String(tipo).toLowerCase().trim();
  if (t === "perfuração") return "perfuracao";
  return t;
}

/** Pega flavor do termo (DiceTerm costuma ter .flavor; às vezes vem em .options.flavor) */
function obterFlavorDoTermo(term) {
  return term?.flavor ?? term?.options?.flavor ?? null;
}

/**
 * Extrai dano por tipo a partir de rollDano.terms (Foundry V13).
 * Tratamento especial: bônus numérico do tipo "+ 12[corte]" pode virar NumericTerm sem flavor,
 * então herdamos o último tipo visto quando o operador anterior for "+".
 *
 * Retorno serializável:
 *  - danoPorTipoArr: [{tipo:"corte", valor: 32}, {tipo:"fogo", valor: 17}]
 *  - danoDesconhecido: número (termos sem flavor)
 */
function extrairDanoPorTipoV13(rollDano) {
  const porTipo = new Map();
  let desconhecido = 0;

  if (!rollDano) return { danoPorTipoArr: [], danoDesconhecido: 0 };

  let ultimoTipo = null;
  let ultimoOperador = null; // "+", "-", null

  for (const term of rollDano.terms ?? []) {
    // OperatorTerm no V13 costuma expor .operator
    if (typeof term?.operator === "string") {
      ultimoOperador = term.operator;
      continue;
    }

    const isDice = term?.results && Array.isArray(term.results);
    const isNumeric = typeof term?.number === "number";

    let valor = null;
    if (isDice) valor = Number(term.total ?? 0);
    else if (isNumeric) valor = Number(term.number ?? 0);
    else continue;

    let tipo = normalizarTipo(obterFlavorDoTermo(term));

    // herda tipo para número sem flavor se estivermos em "... + 12"
    if (!tipo && isNumeric && ultimoTipo && (ultimoOperador === "+" || ultimoOperador === null)) {
      tipo = ultimoTipo;
    }

    // atualiza memória do último tipo quando aparece um termo tipado
    if (tipo) ultimoTipo = tipo;

    // se operador era "-", torna o valor negativo
    if (ultimoOperador === "-") valor = -Math.abs(valor);

    if (tipo) porTipo.set(tipo, (porTipo.get(tipo) ?? 0) + valor);
    else desconhecido += valor;

    ultimoOperador = null;
  }

  const danoPorTipoArr = Array.from(porTipo.entries()).map(([tipo, valor]) => ({ tipo, valor }));
  return { danoPorTipoArr, danoDesconhecido: desconhecido };
}

Hooks.on("createChatMessage", async (message, options, userId) => {
  try {
    if (!message.rolls?.length) return;
    if (userId !== game.userId) return;

    const rollAtaque = message.rolls.find(r => r.formula?.includes("d20"));
    if (!rollAtaque) return;

    const rollDano = message.rolls.find(r => !r.formula?.includes("d20"));
    const targets = Array.from(game.user.targets);
    if (!targets.length) return;

    const totalAtaque = rollAtaque.total;
    const d20Result = rollAtaque.dice?.[0]?.results?.[0]?.result;

    // Crit threshold real (algumas armas/efeitos mudam o crítico)
    const critThreshold = rollAtaque.dice?.[0]?.options?.critical ?? 20;

    const danoBase = rollDano ? rollDano.total : null;

    // Texto auxiliar (não é mais a base do cálculo de tipos, mas mantém pro log/diagnóstico)
    const formulaDano = rollDano?.formula ?? "";
    const flavorDano = (message.flavor ?? "") + " " + (message.content ?? "") + " " + formulaDano;

    // NOVO: dano por tipo (serializável)
    const { danoPorTipoArr, danoDesconhecido } = extrairDanoPorTipoV13(rollDano);

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
        defesa,
        pvAtual,
        pvMax,
        rdGeral,
        tracos, // objeto completo para processar
        acertou: !(d20Result === 1) && totalAtaque >= defesa,
        erroNatural: d20Result === 1,
        possivelCritico: typeof d20Result === "number" ? d20Result >= critThreshold : false
      };
    });

    await criarMensagemPublica(totalAtaque, dadosAlvos);

    if (game.user.isGM) {
      await criarMensagemGM(
        totalAtaque,
        dadosAlvos,
        danoBase,
        flavorDano,
        danoPorTipoArr,
        danoDesconhecido
      );
    } else {
      game.socket.emit("module.t20-attack-automation", {
        tipo: "atacou",
        totalAtaque,
        dadosAlvos,
        danoBase,
        flavorDano,
        danoPorTipoArr,
        danoDesconhecido
      });
    }
  } catch (err) {
    console.error("T20 Attack Automation | erro em createChatMessage:", err);
  }
});

Hooks.once("ready", () => {
  // Recebe do jogador e renderiza pro GM
  game.socket.on("module.t20-attack-automation", async (data) => {
    try {
      if (!game.user.isGM) return;
      if (data?.tipo !== "atacou") return;

      await criarMensagemGM(
        data.totalAtaque,
        data.dadosAlvos,
        data.danoBase,
        data.flavorDano,
        data.danoPorTipoArr,
        data.danoDesconhecido
      );
    } catch (err) {
      console.error("T20 Attack Automation | erro no socket GM:", err);
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
    const cor = a.erroNatural
      ? "#888"
      : a.possivelCritico && a.acertou
        ? "#ff6b35"
        : a.acertou
          ? "#27ae60"
          : "#e74c3c";

    const label = a.erroNatural
      ? "💨 Erro Natural"
      : a.possivelCritico && a.acertou
        ? "⚔️ CRÍTICO!"
        : a.acertou
          ? "✅ Acertou!"
          : "❌ Errou";

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

async function criarMensagemGM(totalAtaque, dadosAlvos, danoBase, flavorDano, danoPorTipoArr = [], danoDesconhecido = 0) {
  const temDano = danoBase !== null && danoBase !== undefined;

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
    const cor = a.erroNatural
      ? "#555"
      : a.possivelCritico && a.acertou
        ? "#ff6b35"
        : a.acertou
          ? "#27ae60"
          : "#e74c3c";

    const label = a.erroNatural
      ? "💨 Erro Natural"
      : a.possivelCritico && a.acertou
        ? "⚔️ CRÍTICO!"
        : a.acertou
          ? "✅ Acertou"
          : "❌ Errou";

    // Resumo de resistências para mostrar no painel
    const resInfo = Object.entries(a.tracos ?? {})
      .filter(([_, v]) => v?.imunidade || v?.vulnerabilidade || v?.value > 0)
      .map(([k, v]) =>
        v?.imunidade ? `Imune: ${k}` : v?.vulnerabilidade ? `Vuln: ${k}` : `RD ${v.value} (${k})`
      )
      .join(" · ");

    // Calcular dano final (multi-tipo) e notas
    let danoAntes = 0; // soma ANTES da RD geral
    let notasRes = [];
    let breakdown = [];

    if (temDano) {
      // 1) Aplica RD/imunidade/vulnerabilidade por tipo
      for (const parte of (danoPorTipoArr ?? [])) {
        const tipo = normalizarTipo(parte.tipo);
        let parcial = Number(parte.valor ?? 0);

        const traco = tipo ? a.tracos?.[tipo] : null;

        if (traco?.imunidade) {
          breakdown.push(`${tipo}: ${parcial}→0 (imune)`);
          notasRes.push(`${tipo}: imune`);
          parcial = 0;
        } else {
          // vulnerabilidade
          if (traco?.vulnerabilidade) {
            const antes = parcial;
            parcial = parcial * 2;
            breakdown.push(`${tipo}: ${antes}→${parcial} (vuln)`);
            notasRes.push(`${tipo}: vulnerável ×2`);
          }

          // RD específica do tipo
          if ((traco?.value ?? 0) > 0 && parcial > 0) {
            const rdEsp = traco.value;
            const antes = parcial;
            parcial = Math.max(0, parcial - rdEsp);
            breakdown.push(`${tipo}: ${antes}→${parcial} (RD ${rdEsp})`);
            notasRes.push(`${tipo}: RD ${rdEsp}`);
          } else if (!traco?.vulnerabilidade) {
            // sem ajuste, só mostra o valor
            breakdown.push(`${tipo}: ${parcial}`);
          }
        }

        danoAntes += parcial;
      }

      // 2) Adiciona dano sem tipo
      if ((danoDesconhecido ?? 0) !== 0) {
        const semTipo = Number(danoDesconhecido);
        danoAntes += semTipo;
        breakdown.push(`sem tipo: ${semTipo}`);
        notasRes.push(`sem tipo: sem ajuste`);
      }

      // 3) RD geral UMA VEZ no total acumulado
      let danoFinal = danoAntes;
      if (a.rdGeral > 0 && danoAntes > 0) {
        danoFinal = Math.max(0, danoAntes - a.rdGeral);
        notasRes.push(`RD geral ${a.rdGeral}: ${danoAntes}→${danoFinal}`);
      }

      // Guarda o dano final calculado para os botões
      a._danoFinalCalculado = danoFinal;
    } else {
      a._danoFinalCalculado = 0;
    }

    const notaStr = notasRes.length ? ` (${notasRes.join(", ")})` : "";
    const breakdownStr = breakdown.length ? breakdown.join(" + ") : "";

    const danoFinalExibir = a._danoFinalCalculado ?? 0;

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
        ${temDano && breakdownStr ? `<div style="font-size:0.78em;color:#aaa;margin-top:4px">Dano por tipo: ${breakdownStr}</div>` : ""}
        ${a.acertou && temDano ? `
        <div style="font-size:0.85em;color:#ccc;margin-top:6px">
          Dano calculado: <b>${danoFinalExibir}</b>${notaStr}
        </div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="t20-aplicar"
            data-token="${a.tokenId}"
            data-dano-final="${danoFinalExibir}"
            data-critico="${a.possivelCritico ? 1 : 0}"
            style="flex:1;padding:5px;border-radius:4px;cursor:pointer;
              background:#7a1a1a;border:1px solid #a02020;color:#fff;font-size:0.85em">
            💔 Aplicar ${danoFinalExibir} de Dano
          </button>
          <button class="t20-metade"
            data-token="${a.tokenId}"
            data-dano-final="${Math.floor(danoFinalExibir / 2)}"
            data-critico="0"
            style="flex:1;padding:5px;border-radius:4px;cursor:pointer;
              background:#2c3e50;border:1px solid #3d5166;color:#fff;font-size:0.85em">
            🛡️ Metade (${Math.floor(danoFinalExibir / 2)})
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
