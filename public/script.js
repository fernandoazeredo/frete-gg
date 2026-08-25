/* eslint-env browser */
/* global L */

(function () {
  "use strict";

  /* =========================
     CONFIG
     ========================= */
  var NOMINATIM_URL =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=";
  var OSRM_URL = "https://router.project-osrm.org/route/v1/driving/";

  // Mantém as consultas de endereço em fila para respeitar o limite do Nominatim.
  var GEOCODE_MIN_INTERVAL_MS = 1100;
  var lastGeocodeCallAt = 0;
  var geocodeQueue = Promise.resolve();

  function waitGeocodeSlot() {
    geocodeQueue = geocodeQueue.then(function () {
      var now = Date.now();
      var wait = Math.max(
        0,
        lastGeocodeCallAt + GEOCODE_MIN_INTERVAL_MS - now
      );
      lastGeocodeCallAt = Math.max(now, lastGeocodeCallAt) + wait;

      if (!wait) return undefined;
      return new Promise(function (resolve) {
        setTimeout(resolve, wait);
      });
    });

    return geocodeQueue;
  }

  var TABELA_VALOR_KM = {
    "carro leve": 5.19,
    vuc: 7.42,
    "3/4": 7.79,
    toco: 8.16,
    truck: 8.9,
    outro: 0.0
  };

  /* =========================
     HELPERS
     ========================= */
  function $(id) {
    return document.getElementById(id);
  }

  function normTipo(txt) {
    return String(txt || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function clampNum(n) {
    var x = Number(n);
    return isFinite(x) ? x : 0;
  }

  function toFixed1PtBr(n) {
    var x = clampNum(n);
    return x.toFixed(1).replace(".", ",");
  }

  function formatCurrency(n) {
    var v = clampNum(n);
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function parseBRLToNumber(str) {
    var s = String(str || "").trim();
    if (!s) return 0;
    s = s.replace(/[R$\s]/g, "");
    s = s.replace(/\./g, "");
    s = s.replace(",", ".");
    var v = Number(s);
    return isFinite(v) ? v : 0;
  }

  function toCents(v) {
    return Math.round(clampNum(v) * 100);
  }

  function centsToNumber(c) {
    return clampNum(c) / 100;
  }

  function formatDateTimeLocalToBr(val) {
    var s = String(val || "").trim();
    if (!s) return "";
    var parts = s.split("T");
    if (parts.length !== 2) return s;
    var d = parts[0].split("-");
    if (d.length !== 3) return s;
    var y = d[0],
      m = d[1],
      dd = d[2];
    var hhmm = parts[1].slice(0, 5);
    return dd + "/" + m + "/" + y + " " + hhmm;
  }

  function setText(el, txt) {
    if (!el) return;
    el.textContent = String(txt == null ? "" : txt);
  }

  function showToast(msg, kind) {
    if (!msg) return;
    var box = $("__freteToastBox");

    if (!box) {
      box = document.createElement("div");
      box.id = "__freteToastBox";
      box.setAttribute("role", "status");
      box.setAttribute("aria-live", "polite");
      box.style.position = "fixed";
      box.style.top = "16px";
      box.style.left = "50%";
      box.style.transform = "translateX(-50%)";
      box.style.zIndex = "99999";
      box.style.display = "flex";
      box.style.flexDirection = "column";
      box.style.gap = "8px";
      box.style.pointerEvents = "none";
      document.body.appendChild(box);
    }

    var toast = document.createElement("div");
    toast.textContent = msg;
    toast.style.padding = "10px 16px";
    toast.style.borderRadius = "8px";
    toast.style.fontSize = "14px";
    toast.style.fontWeight = "600";
    toast.style.color = "#fff";
    toast.style.background = kind === "error" ? "#c0392b" : "#1e8449";
    toast.style.boxShadow = "0 4px 14px rgba(0,0,0,0.35)";
    toast.style.maxWidth = "90vw";
    toast.style.textAlign = "center";
    box.appendChild(toast);

    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 5000);
  }

  function markFieldInvalid(el) {
    if (!el) return;
    el.style.outline = "2px solid #e74c3c";
    el.style.outlineOffset = "2px";

    setTimeout(function () {
      el.style.outline = "";
      el.style.outlineOffset = "";
    }, 4000);

    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus();
    } catch (e) {}
  }

  // Atualiza por ID com segurança, mesmo se o objeto elPonta/elFrac estiver desatualizado
  function setTextById(id, txt) {
    var el = $(id);
    if (el) setText(el, txt);
  }

  function setTextsByIds(ids, txt) {
    for (var i = 0; i < ids.length; i++) setTextById(ids[i], txt);
  }

  // Atualiza os cards inferiores do extrato e aceita IDs alternativos.
  // Para Ponta a Ponta: média = total dos fretes / quantidade de viagens.
  // Para Fracionado: pode receber outro divisor/base para média por destino/trecho.
  function updateResumoExtrato(
    prefix,
    qtd,
    totalCent,
    mediaDivisor,
    mediaBaseCent
  ) {
    var totalTxt = formatCurrency(centsToNumber(totalCent));

    var divisorMedia =
      typeof mediaDivisor === "number" &&
      isFinite(mediaDivisor) &&
      mediaDivisor > 0
        ? mediaDivisor
        : qtd;

    var baseMedia =
      typeof mediaBaseCent === "number" && isFinite(mediaBaseCent)
        ? mediaBaseCent
        : totalCent;

    var mediaCent = divisorMedia ? Math.round(baseMedia / divisorMedia) : 0;
    var mediaTxt = formatCurrency(centsToNumber(mediaCent));

    setTextsByIds(
      [
        prefix + "_resTotalViagens",
        prefix + "_totalViagens",
        prefix + "_total_viagens",
        prefix + "_qtdViagens"
      ],
      String(qtd)
    );

    setTextsByIds(
      [
        prefix + "_resTotalFretes",
        prefix + "_totalFretes",
        prefix + "_total_fretes",
        prefix + "_somatorioExtrato",
        prefix + "_somatorio_extrato"
      ],
      totalTxt
    );

    setTextsByIds(
      [
        prefix + "_resMediaFrete",
        prefix + "_mediaFrete",
        prefix + "_media_frete",
        prefix + "_mediaExtrato",
        prefix + "_media_extrato"
      ],
      mediaTxt
    );
  }

  // Resumo específico do Ponta a Ponta.
  // Regra: média = somatório de todas as viagens / quantidade de viagens.
  // Exemplo: 5 viagens somando R$ 300,00 => média R$ 60,00.
  function calcularResumoPonta() {
    var qtd = Array.isArray(ponta.extrato) ? ponta.extrato.length : 0;
    var totalCent = 0;

    if (Array.isArray(ponta.extrato)) {
      for (var i = 0; i < ponta.extrato.length; i++) {
        var it = normalizeExtratoItem(ponta.extrato[i]) || {};
        var freteCent = getFreteCentValue(it);

        // Fallback para registros antigos que possam ter sido salvos sem freteCent.
        if (!freteCent) {
          var kmAntigo = clampNum(it.km);
          var valorKmAntigo = clampNum(it.valorKm);
          if (kmAntigo && valorKmAntigo)
            freteCent = toCents(kmAntigo * valorKmAntigo);
        }

        totalCent += clampNum(freteCent);
      }
    }

    // Fallback final: se por qualquer motivo o array estiver sem valor, lê a coluna Frete da tabela.
    // Isso evita card zerado quando há linhas visíveis no extrato.
    if (!totalCent) {
      var table = $("ponta_tabelaExtrato");
      var rows = table ? table.querySelectorAll("tbody tr") : [];
      var totalTabelaCent = 0;
      var qtdTabela = 0;

      for (var r = 0; r < rows.length; r++) {
        var cells = rows[r].children || [];
        if (cells.length >= 8) {
          var valor = parseBRLToNumber(cells[7].textContent || "");
          if (valor) {
            totalTabelaCent += toCents(valor);
            qtdTabela += 1;
          }
        }
      }

      if (totalTabelaCent) {
        totalCent = totalTabelaCent;
        qtd = qtdTabela;
      }
    }

    return {
      qtd: qtd,
      totalCent: totalCent,
      mediaCent: qtd ? Math.round(totalCent / qtd) : 0
    };
  }

  function atualizarResumoPonta() {
    var r = calcularResumoPonta();
    updateResumoExtrato("ponta", r.qtd, r.totalCent, r.qtd, r.totalCent);
  }

  function updateFracMediaLabels() {
    var mediaEl = $("frac_resMediaFrete");
    if (!mediaEl) return;

    var card = mediaEl.closest ? mediaEl.closest(".resumo-card") : null;
    if (!card) return;

    var title = card.querySelector(".resumo-title");
    var sub = card.querySelector(".resumo-sub");

    if (title) title.textContent = "Média por destino";
    if (sub) sub.textContent = "Média dos trechos/destinos";
  }

  function getFracTrechosStats(reg) {
    var out = { qtd: 0, totalCent: 0, totalKm: 0 };
    if (!reg || !reg.trechos || !reg.trechos.length) return out;

    for (var i = 0; i < reg.trechos.length; i++) {
      var leg = reg.trechos[i] || {};
      var kmLeg = clampNum(leg.km);
      var valorKm =
        typeof reg.valorKm === "number" && isFinite(reg.valorKm)
          ? reg.valorKm
          : getValorKmByTipo(reg.tipo || "");

      var vCent =
        typeof leg.valueCent === "number" && isFinite(leg.valueCent)
          ? Math.round(leg.valueCent)
          : toCents(kmLeg * clampNum(valorKm));

      out.qtd += 1;
      out.totalKm += kmLeg;
      out.totalCent += vCent;
    }

    return out;
  }

  function getTbodyOrNull(tableEl) {
    if (!tableEl) return null;
    var tb = tableEl.tBodies && tableEl.tBodies[0] ? tableEl.tBodies[0] : null;
    if (!tb && tableEl.createTBody) tb = tableEl.createTBody();
    return tb || null;
  }

  function getFreteCentValue(it) {
    if (!it) return 0;
    if (typeof it.freteCent === "number" && isFinite(it.freteCent))
      return Math.round(it.freteCent);
    if (typeof it.frete === "number" && isFinite(it.frete))
      return toCents(it.frete);
    if (typeof it.valorFrete === "number" && isFinite(it.valorFrete))
      return toCents(it.valorFrete);
    if (it.frete) return toCents(parseBRLToNumber(it.frete));
    if (it.valorFrete) return toCents(parseBRLToNumber(it.valorFrete));
    return 0;
  }

  function normalizeExtratoItem(it) {
    if (!it) return it;
    it.freteCent = getFreteCentValue(it);
    if (typeof it.lucroCent !== "number" || !isFinite(it.lucroCent))
      it.lucroCent = 0;
    if (typeof it.km !== "number" || !isFinite(it.km))
      it.km = parseBRLToNumber(it.km);
    if (typeof it.valorKm !== "number" || !isFinite(it.valorKm))
      it.valorKm = parseBRLToNumber(it.valorKm);
    return it;
  }

  function fetchJSON(url) {
    return fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" }
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function geocodeOneAttempt(q) {
    return waitGeocodeSlot().then(function () {
      return fetchJSON(NOMINATIM_URL + encodeURIComponent(q)).then(function (
        arr
      ) {
        if (!arr || !arr.length)
          throw new Error("Endereço não encontrado: " + q);

        var pt = {
          lat: Number(arr[0].lat),
          lon: Number(arr[0].lon),
          display: arr[0].display_name || q
        };

        if (!isValidPoint(pt))
          throw new Error("Coordenada inválida para: " + q);
        return pt;
      });
    });
  }

  function geocodeOne(query) {
    var q = String(query || "").trim();
    if (!q) return Promise.reject(new Error("Endereço vazio"));

    return geocodeOneAttempt(q).catch(function (err) {
      var msg = err && err.message ? err.message : "";
      if (/não encontrado|inválida/.test(msg)) throw err;
      return geocodeOneAttempt(q);
    });
  }

  function osrmRoute(coordsLonLat) {
    if (!coordsLonLat || coordsLonLat.length < 2)
      return Promise.reject(new Error("Coordenadas insuficientes para rota."));
    var coordStr = coordsLonLat.join(";");
    if (
      !coordStr ||
      coordStr.indexOf("NaN") >= 0 ||
      coordStr.indexOf("undefined") >= 0
    ) {
      return Promise.reject(new Error("Coordenadas inválidas para rota."));
    }
    var url =
      OSRM_URL + coordStr + "?overview=full&geometries=geojson&steps=false";
    return fetchJSON(url).then(function (data) {
      if (!data || data.code !== "Ok" || !data.routes || !data.routes[0]) {
        throw new Error("Falha ao calcular rota (OSRM).");
      }
      return data.routes[0];
    });
  }

  // ✅ Limpeza leve (especialmente para o PDF)
  function cleanLabel(s) {
    var t = String(s || "");
    t = t.replace(/!/g, "");
    t = t.replace(/\s+'\s+/g, " ");
    t = t.replace(/\s{2,}/g, " ").trim();
    return t;
  }

  // ✅ Quebra de texto SOMENTE para PDF
  function wrapLongText(s, maxLen) {
    var t = String(s || "").trim();
    if (!t) return "";
    if (t.length <= maxLen) return t;

    var out = "";
    var line = "";
    var parts = t.split(" ");
    for (var i = 0; i < parts.length; i++) {
      var w = parts[i];
      var next = line ? line + " " + w : w;
      if (next.length > maxLen) {
        out += (out ? "\n" : "") + line;
        line = w;
      } else {
        line = next;
      }
    }
    if (line) out += (out ? "\n" : "") + line;

    out = out.replace(/\s\|\s/g, " |\n");
    return out;
  }

  function joinDestinos(destinosArr) {
    if (!destinosArr || !destinosArr.length) return "";
    var out = [];
    for (var i = 0; i < destinosArr.length; i++) {
      var s = String(destinosArr[i] || "").trim();
      if (s) out.push(s);
    }
    return out.join(" | ");
  }

  // ✅ CARD: sempre 1 linha (não quebra)
  function applyNoWrap(td) {
    td.style.whiteSpace = "nowrap";
    td.style.wordBreak = "keep-all";
    td.style.overflowWrap = "normal";
  }

  // ✅ PDF/uso especial: permite quebra (não usar no CARD)
  function applyWrap(td) {
    td.style.whiteSpace = "pre-wrap";
    td.style.wordBreak = "break-word";
    td.style.overflowWrap = "anywhere";
  }

  // mode: "nowrap" | "wrap"
  function appendTd(tr, txt, right, mode) {
    var td = document.createElement("td");
    td.textContent = String(txt == null ? "" : txt);
    if (right) td.style.textAlign = "right";

    if (mode === "wrap") applyWrap(td);
    else applyNoWrap(td);

    tr.appendChild(td);
    return td;
  }

  function clearTbody(tableEl) {
    // Antes, se o <tbody> não existisse ou a tabela não fosse encontrada,
    // a renderização parava antes de atualizar Total de fretes e Média.
    if (!tableEl) return document.createDocumentFragment();

    var tb = tableEl.tBodies && tableEl.tBodies[0] ? tableEl.tBodies[0] : null;
    if (!tb && tableEl.createTBody) tb = tableEl.createTBody();
    if (!tb) return document.createDocumentFragment();

    tb.innerHTML = "";
    return tb;
  }

  function ensureJsPDF() {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error("jsPDF não carregado.");
    }
    return window.jspdf.jsPDF;
  }

  /* =========================
     PDF HELPERS (EXTRATO)
     ========================= */
  function pdfNowBr() {
    try {
      return new Date().toLocaleString("pt-BR");
    } catch (e) {
      return "";
    }
  }

  function pdfSafeText(v) {
    return cleanLabel(String(v == null ? "" : v));
  }

  function pdfAddHeader(doc, titulo) {
    var pageW = doc.internal.pageSize.getWidth();

    doc.setFillColor(20, 93, 81);
    doc.rect(0, 0, pageW, 54, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("Grupo Galvão", 34, 23);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Simulador de Frete - Extrato Operacional", 34, 39);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(titulo, pageW - 34, 23, { align: "right" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Emitido em: " + pdfNowBr(), pageW - 34, 39, { align: "right" });

    doc.setTextColor(30, 30, 30);
  }

  function pdfAddFooter(doc) {
    var pageCount = doc.internal.getNumberOfPages();
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();

    for (var i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setDrawColor(210, 210, 210);
      doc.line(34, pageH - 28, pageW - 34, pageH - 28);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(110, 110, 110);
      doc.text(
        "Extrato gerado automaticamente pelo Simulador de Frete",
        34,
        pageH - 14
      );
      doc.text("Página " + i + " de " + pageCount, pageW - 34, pageH - 14, {
        align: "right"
      });
      doc.setTextColor(30, 30, 30);
    }
  }

  function pdfSummaryTable(doc, startY, rows) {
    doc.autoTable({
      startY: startY,
      body: rows,
      theme: "grid",
      margin: { left: 34, right: 34 },
      styles: {
        fontSize: 9,
        cellPadding: 5,
        overflow: "linebreak",
        valign: "middle"
      },
      columnStyles: {
        0: { fontStyle: "bold", fillColor: [241, 246, 245], cellWidth: 120 },
        1: { halign: "right", cellWidth: 95 },
        2: { fontStyle: "bold", fillColor: [241, 246, 245], cellWidth: 120 },
        3: { halign: "right", cellWidth: 95 },
        4: { fontStyle: "bold", fillColor: [241, 246, 245], cellWidth: 120 },
        5: { halign: "right", cellWidth: 95 }
      }
    });
    return doc.lastAutoTable.finalY;
  }

  function pdfSectionTitle(doc, title, y) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(20, 93, 81);
    doc.text(title, 34, y);
    doc.setTextColor(30, 30, 30);
    return y + 8;
  }

  /* =========================
     STATE
     ========================= */
  var ponta = {
    map: null,
    layerRoute: null,
    markers: [],
    extrato: []
  };

  var frac = {
    map: null,
    layerRoute: null,
    markers: [],
    destinosInputs: [],
    last: {
      destinos: [],
      legs: [],
      kmTotal: 0
    },
    extrato: []
  };

  /* =========================
     ELEMENTS (PONTA)
     ========================= */
  var elPonta = {
    tipo: $("ponta_tipoVeiculo"),
    placa: $("ponta_placa"),
    saida: $("ponta_saida"),
    chegada: $("ponta_chegada"),
    origem: $("ponta_origem"),
    destino: $("ponta_destino"),
    dist: $("ponta_distancia"),
    valorKm: $("ponta_valorKm"),
    carga: $("ponta_cargaDescarga"),
    pedagios: $("ponta_pedagios"),
    outros: $("ponta_outros"),
    margem: $("ponta_margem"),
    obs: $("ponta_obs"),

    btnRota: $("ponta_btnRota"),
    btnLimpar: $("ponta_btnLimpar"),
    btnAddExtrato: $("ponta_btnAdicionarExtrato"),
    btnPdf: $("ponta_btnExportarPDF"),
    btnClearExtrato: $("ponta_btnLimparExtrato"),

    mapStatus: $("ponta_mapStatus"),

    resCustoBase: $("ponta_resCustoBase"),
    resCustosAdicionais: $("ponta_resCustosAdicionais"),
    resCustoTotal: $("ponta_resCustoTotal"),
    resLucro: $("ponta_resLucro"),
    resFrete: $("ponta_resFreteSugerido"),

    tabelaExtrato: $("ponta_tabelaExtrato"),
    resTotalViagens: $("ponta_resTotalViagens"),
    resTotalFretes: $("ponta_resTotalFretes"),
    resMediaFrete: $("ponta_resMediaFrete")
  };

  /* =========================
     ELEMENTS (FRAC)
     ========================= */
  var elFrac = {
    tipo: $("frac_tipoVeiculo"),
    placa: $("frac_placa"),
    saida: $("frac_saida"),
    chegada: $("frac_chegada"),
    origem: $("frac_origem"),
    dist: $("frac_distancia"),
    valorKm: $("frac_valorKm"),
    carga: $("frac_cargaDescarga"),
    pedagios: $("frac_pedagios"),
    outros: $("frac_outros"),
    margem: $("frac_margem"),
    obs: $("frac_obs"),

    btnAddDestino: $("frac_btnAddDestino"),
    btnLimparDestinos: $("frac_btnLimparDestinos"),
    destinosContainer: $("frac_destinosContainer"),

    btnRota: $("frac_btnRota"),
    btnLimpar: $("frac_btnLimpar"),
    btnAddExtrato: $("frac_btnAdicionarExtrato"),
    btnPdf: $("frac_btnExportarPDF"),
    btnClearExtrato: $("frac_btnLimparExtrato"),

    mapStatus: $("frac_mapStatus"),

    resCustoBase: $("frac_resCustoBase"),
    resCustosAdicionais: $("frac_resCustosAdicionais"),
    resCustoTotal: $("frac_resCustoTotal"),
    resLucro: $("frac_resLucro"),
    resFrete: $("frac_resFreteSugerido"),

    tabelaTrechos: $("frac_tabelaTrechos"),
    tabelaExtrato: $("frac_tabelaExtrato"),
    resTotalViagens: $("frac_resTotalViagens"),
    resTotalFretes: $("frac_resTotalFretes"),
    resMediaFrete: $("frac_resMediaFrete")
  };

  /* =========================
     THEME TOGGLE (opcional)
     ========================= */
  var themeToggle = $("themeToggle");
  function toggleTheme() {
    var b = document.body;
    if (!b) return;
    if (b.classList.contains("theme-dark")) {
      b.classList.remove("theme-dark");
      b.classList.add("theme-light");
    } else {
      b.classList.remove("theme-light");
      b.classList.add("theme-dark");
    }
  }

  /* =========================
     MAP INIT
     ========================= */
  function initMapPonta() {
    var mapEl = $("ponta_map");
    if (!mapEl || !window.L) {
      if (elPonta && elPonta.mapStatus) {
        setText(
          elPonta.mapStatus,
          "Status: mapa indisponível, mas os cálculos continuam ativos."
        );
      }
      return;
    }

    try {
      if (ponta.map) return;
      ponta.map = L.map(mapEl, { zoomControl: true }).setView(
        [-22.9068, -43.1729],
        11
      );

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
      }).addTo(ponta.map);
    } catch (e) {
      ponta.map = null;
      setText(
        elPonta.mapStatus,
        "Status: mapa indisponível, mas os cálculos continuam ativos."
      );
    }
  }

  function initMapFrac() {
    var mapEl = $("frac_map");
    if (!mapEl || !window.L) {
      if (elFrac && elFrac.mapStatus) {
        setText(
          elFrac.mapStatus,
          "Status: mapa indisponível, mas os cálculos continuam ativos."
        );
      }
      return;
    }

    try {
      if (frac.map) return;
      frac.map = L.map(mapEl, { zoomControl: true }).setView(
        [-22.9068, -43.1729],
        11
      );

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
      }).addTo(frac.map);
    } catch (e) {
      frac.map = null;
      setText(
        elFrac.mapStatus,
        "Status: mapa indisponível, mas os cálculos continuam ativos."
      );
    }
  }

  function clearRouteOnMap(stateObj) {
    if (!stateObj) return;
    if (stateObj.layerRoute && stateObj.map) {
      try {
        stateObj.map.removeLayer(stateObj.layerRoute);
      } catch (e) {}
    }
    stateObj.layerRoute = null;

    if (stateObj.markers && stateObj.map) {
      for (var i = 0; i < stateObj.markers.length; i++) {
        try {
          stateObj.map.removeLayer(stateObj.markers[i]);
        } catch (e2) {}
      }
    }
    stateObj.markers = [];
  }

  function drawRoute(stateObj, geojsonLine, points, fit) {
    if (!stateObj || !stateObj.map) return;
    clearRouteOnMap(stateObj);

    stateObj.layerRoute = L.geoJSON(geojsonLine, {
      style: function () {
        return { weight: 5, opacity: 0.85 };
      }
    }).addTo(stateObj.map);

    if (points && points.length) {
      for (var i = 0; i < points.length; i++) {
        var mk = L.marker([points[i].lat, points[i].lon]).addTo(stateObj.map);
        stateObj.markers.push(mk);
      }
    }

    if (fit) {
      try {
        var b = stateObj.layerRoute.getBounds();
        stateObj.map.fitBounds(b, { padding: [20, 20] });
      } catch (e) {}
    }
  }

  function isValidPoint(pt) {
    if (!pt) return false;
    var lat = Number(pt.lat);
    var lon = Number(pt.lon);
    return (
      isFinite(lat) &&
      isFinite(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180
    );
  }

  function haversineKm(a, b) {
    if (!isValidPoint(a) || !isValidPoint(b)) return 0;
    var R = 6371;
    var lat1 = (Number(a.lat) * Math.PI) / 180;
    var lat2 = (Number(b.lat) * Math.PI) / 180;
    var dLat = ((Number(b.lat) - Number(a.lat)) * Math.PI) / 180;
    var dLon = ((Number(b.lon) - Number(a.lon)) * Math.PI) / 180;
    var h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function lineGeometryFromPoints(points) {
    var coords = [];
    for (var i = 0; points && i < points.length; i++) {
      if (isValidPoint(points[i]))
        coords.push([Number(points[i].lon), Number(points[i].lat)]);
    }
    return { type: "LineString", coordinates: coords };
  }

  function drawRouteSegments(stateObj, legs, points, fit) {
    if (!stateObj || !stateObj.map) return;
    clearRouteOnMap(stateObj);

    var features = [];
    for (var i = 0; legs && i < legs.length; i++) {
      if (
        legs[i] &&
        legs[i].geometry &&
        legs[i].geometry.coordinates &&
        legs[i].geometry.coordinates.length
      ) {
        features.push({
          type: "Feature",
          properties: {},
          geometry: legs[i].geometry
        });
      }
    }

    if (!features.length && points && points.length > 1) {
      features.push({
        type: "Feature",
        properties: {},
        geometry: lineGeometryFromPoints(points)
      });
    }

    if (!features.length) return;

    stateObj.layerRoute = L.geoJSON(
      { type: "FeatureCollection", features: features },
      {
        style: function () {
          return { weight: 5, opacity: 0.85 };
        }
      }
    ).addTo(stateObj.map);

    if (points && points.length) {
      for (var j = 0; j < points.length; j++) {
        if (!isValidPoint(points[j])) continue;
        var mk = L.marker([Number(points[j].lat), Number(points[j].lon)]).addTo(
          stateObj.map
        );
        stateObj.markers.push(mk);
      }
    }

    if (fit) {
      try {
        stateObj.map.fitBounds(stateObj.layerRoute.getBounds(), {
          padding: [20, 20]
        });
      } catch (e) {}
    }
  }

  /* =========================
     VEHICLE -> VALOR KM
     ========================= */
  function getValorKmByTipo(tipoText) {
    var t = normTipo(tipoText);
    if (t === "3/4" || t === "3/4 ") return TABELA_VALOR_KM["3/4"];
    if (t === "carro leve") return TABELA_VALOR_KM["carro leve"];
    if (t === "vuc") return TABELA_VALOR_KM.vuc;
    if (t === "toco") return TABELA_VALOR_KM.toco;
    if (t === "truck") return TABELA_VALOR_KM.truck;
    if (t === "outro") return TABELA_VALOR_KM.outro;
    return 0;
  }

  /* ======= ✅ CORREÇÃO CIRÚRGICA: "Outro" editável e valor do input usado ======= */
  function isOutro(tipoText) {
    return normTipo(tipoText) === "outro";
  }

  function getValorKmFromUI(tipoEl, valorKmEl) {
    var tipoTxt = tipoEl ? tipoEl.value : "";
    if (isOutro(tipoTxt)) {
      return parseBRLToNumber(valorKmEl ? valorKmEl.value : "");
    }
    return getValorKmByTipo(tipoTxt);
  }

  function syncValorKmField(tipoEl, valorKmEl) {
    if (!valorKmEl) return;

    var tipoTxt = tipoEl ? tipoEl.value : "";

    if (isOutro(tipoTxt)) {
      // libera edição somente em "Outro"
      valorKmEl.removeAttribute("readonly");
      valorKmEl.placeholder = "Digite o valor (ex.: 4,90)";
      // não sobrescreve o que o usuário digitou
    } else {
      // mantém automático nos demais
      valorKmEl.setAttribute("readonly", "readonly");
      valorKmEl.placeholder = "Automático";

      var v = getValorKmByTipo(tipoTxt);
      valorKmEl.value = v ? v.toFixed(2).replace(".", ",") : "";
    }
  }

  function updateValorKmInputs() {
    syncValorKmField(elPonta.tipo, elPonta.valorKm);
    syncValorKmField(elFrac.tipo, elFrac.valorKm);
    recalcPontaPreview();
    recalcFracPreview();
  }
  /* ======= ✅ FIM da correção cirúrgica ======= */

  /* =========================
     COST CALC (CENTAVOS)
     ========================= */
  function calcCustosCent(baseCent, carga, ped, out, margemPct) {
    var addCent = toCents(carga) + toCents(ped) + toCents(out);
    var subtotalCent = baseCent + addCent;

    var m = clampNum(margemPct);
    var lucroCent = Math.round(subtotalCent * (m / 100));
    var freteCent = subtotalCent + lucroCent;

    return {
      baseCent: baseCent,
      addCent: addCent,
      subtotalCent: subtotalCent,
      lucroCent: lucroCent,
      freteCent: freteCent
    };
  }

  /* =========================
     PONTA: PREVIEW + ROTA
     ========================= */
  function recalcPontaPreview() {
    var km = parseBRLToNumber(elPonta.dist ? elPonta.dist.value : "");
    var vkm = getValorKmFromUI(elPonta.tipo, elPonta.valorKm);
    var baseCent = toCents(km * vkm);

    var carga = parseBRLToNumber(elPonta.carga ? elPonta.carga.value : "");
    var ped = parseBRLToNumber(elPonta.pedagios ? elPonta.pedagios.value : "");
    var out = parseBRLToNumber(elPonta.outros ? elPonta.outros.value : "");
    var margem = parseBRLToNumber(elPonta.margem ? elPonta.margem.value : "");

    var r = calcCustosCent(baseCent, carga, ped, out, margem);

    setText(elPonta.resCustoBase, formatCurrency(centsToNumber(r.baseCent)));
    setText(
      elPonta.resCustosAdicionais,
      formatCurrency(centsToNumber(r.addCent))
    );
    setText(
      elPonta.resCustoTotal,
      formatCurrency(centsToNumber(r.subtotalCent))
    );
    setText(elPonta.resLucro, formatCurrency(centsToNumber(r.lucroCent)));
    setText(elPonta.resFrete, formatCurrency(centsToNumber(r.freteCent)));
  }

  function validarTipoVeiculo(elGroup, label) {
    var tipoVal = elGroup.tipo
      ? String(elGroup.tipo.value || "").trim()
      : "";

    if (!tipoVal) {
      showToast(
        "Selecione o tipo de veículo antes de calcular (" + label + ").",
        "error"
      );
      markFieldInvalid(elGroup.tipo);
      return false;
    }

    if (isOutro(tipoVal)) {
      var valorKm = elGroup.valorKm
        ? parseBRLToNumber(elGroup.valorKm.value)
        : 0;

      if (!valorKm) {
        showToast(
          'Informe o "Valor por km" para o tipo "Outro" (' + label + ").",
          "error"
        );
        markFieldInvalid(elGroup.valorKm);
        return false;
      }
    }

    return true;
  }

  function pontaCalcularRota() {
    var origem = elPonta.origem ? elPonta.origem.value : "";
    var destino = elPonta.destino ? elPonta.destino.value : "";

    if (!String(origem || "").trim() || !String(destino || "").trim()) {
      setText(elPonta.mapStatus, "Status: informe origem e destino.");
      if (!String(origem || "").trim()) markFieldInvalid(elPonta.origem);
      else markFieldInvalid(elPonta.destino);
      return;
    }

    if (!validarTipoVeiculo(elPonta, "Ponta a Ponta")) {
      setText(elPonta.mapStatus, "Status: selecione o tipo de veículo.");
      return;
    }

    setText(elPonta.mapStatus, "Status: geocodificando...");
    Promise.all([geocodeOne(origem), geocodeOne(destino)])
      .then(function (pts) {
        var o = pts[0],
          d = pts[1];
        setText(elPonta.mapStatus, "Status: calculando rota...");
        return osrmRoute([o.lon + "," + o.lat, d.lon + "," + d.lat])
          .then(function (route) {
            var km = clampNum(route.distance) / 1000;
            if (elPonta.dist) elPonta.dist.value = toFixed1PtBr(km);
            drawRoute(ponta, route.geometry, [o, d], true);
            setText(elPonta.mapStatus, "Status: rota calculada.");
            recalcPontaPreview();
          })
          .catch(function () {
            var kmEstimado = haversineKm(o, d);
            if (elPonta.dist) elPonta.dist.value = toFixed1PtBr(kmEstimado);
            drawRoute(ponta, lineGeometryFromPoints([o, d]), [o, d], true);
            setText(
              elPonta.mapStatus,
              "Status: rota estimada. Confira a distância antes de salvar."
            );
            recalcPontaPreview();
          });
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : "falha";
        setText(elPonta.mapStatus, "Status: erro — " + msg);
        showToast("Ponta a Ponta: " + msg, "error");

        if (msg.indexOf(origem) >= 0) markFieldInvalid(elPonta.origem);
        else if (msg.indexOf(destino) >= 0)
          markFieldInvalid(elPonta.destino);
      });
  }

  /* =========================
     EXTRATOS LOAD/SAVE
     ========================= */
  // Persistência local: o histórico fica salvo neste navegador entre acessos.
  var EXTRATOS_STORAGE_KEY = "frete_gg_extratos_v1";

  function loadExtratos() {
    ponta.extrato = [];
    frac.extrato = [];

    try {
      var raw = window.localStorage
        ? window.localStorage.getItem(EXTRATOS_STORAGE_KEY)
        : null;

      if (raw) {
        var data = JSON.parse(raw);
        if (data && Array.isArray(data.ponta)) ponta.extrato = data.ponta;
        if (data && Array.isArray(data.frac)) frac.extrato = data.frac;
      }
    } catch (e) {
      // Dados corrompidos ou armazenamento indisponível: inicia vazio.
      ponta.extrato = [];
      frac.extrato = [];
    }
  }

  function saveExtratos() {
    try {
      if (!window.localStorage) return;
      window.localStorage.setItem(
        EXTRATOS_STORAGE_KEY,
        JSON.stringify({
          ponta: ponta.extrato || [],
          frac: frac.extrato || []
        })
      );
    } catch (e) {
      // Modo privado ou limite excedido: não interrompe o aplicativo.
    }
  }

  /* =========================
     PONTA: EXTRATO (CARD) ✅ SEM WRAP
     ========================= */
  function pontaAddExtrato() {
    if (!validarTipoVeiculo(elPonta, "Ponta a Ponta")) return;

    var km = parseBRLToNumber(elPonta.dist ? elPonta.dist.value : "");
    var vkm = getValorKmFromUI(elPonta.tipo, elPonta.valorKm);
    var baseCent = toCents(km * vkm);

    var carga = parseBRLToNumber(elPonta.carga ? elPonta.carga.value : "");
    var ped = parseBRLToNumber(elPonta.pedagios ? elPonta.pedagios.value : "");
    var out = parseBRLToNumber(elPonta.outros ? elPonta.outros.value : "");
    var margem = parseBRLToNumber(elPonta.margem ? elPonta.margem.value : "");

    var r = calcCustosCent(baseCent, carga, ped, out, margem);

    // Segurança: se o cálculo interno vier zerado, mas o card "Frete sugerido" tiver valor, salva o valor exibido.
    if (!r.freteCent) {
      var freteTela = parseBRLToNumber(
        elPonta.resFrete ? elPonta.resFrete.textContent : ""
      );
      if (freteTela > 0) r.freteCent = toCents(freteTela);
    }

    ponta.extrato.push({
      tipo: elPonta.tipo ? elPonta.tipo.value : "",
      placa: elPonta.placa ? elPonta.placa.value : "",
      saida: formatDateTimeLocalToBr(elPonta.saida ? elPonta.saida.value : ""),
      chegada: formatDateTimeLocalToBr(
        elPonta.chegada ? elPonta.chegada.value : ""
      ),
      origem: elPonta.origem ? elPonta.origem.value : "",
      destino: elPonta.destino ? elPonta.destino.value : "",
      km: km,
      valorKm: vkm,
      freteCent: r.freteCent,
      lucroCent: r.lucroCent,
      obs: elPonta.obs ? elPonta.obs.value : ""
    });

    saveExtratos();
    renderPontaExtrato();
    atualizarResumoPonta();
  }

  function pontaRemoveExtrato(idx) {
    if (idx < 0 || idx >= ponta.extrato.length) return;
    ponta.extrato.splice(idx, 1);
    saveExtratos();
    renderPontaExtrato();
  }

  function pontaClearExtrato() {
    ponta.extrato = [];
    saveExtratos();
    renderPontaExtrato();
  }

  function renderPontaExtrato() {
    // Primeiro atualiza o resumo pela regra correta:
    // média = somatório de todas as viagens / quantidade de viagens.
    atualizarResumoPonta();

    var tb = getTbodyOrNull(elPonta.tabelaExtrato);
    if (!tb) return;
    tb.innerHTML = "";

    for (var i = 0; i < ponta.extrato.length; i++) {
      var it = normalizeExtratoItem(ponta.extrato[i]) || {};
      var freteCent = getFreteCentValue(it);

      // Fallback visual para registros antigos.
      if (!freteCent && clampNum(it.km) && clampNum(it.valorKm)) {
        freteCent = toCents(clampNum(it.km) * clampNum(it.valorKm));
      }

      var tr = document.createElement("tr");
      appendTd(tr, it.tipo || "", false, "nowrap");
      appendTd(tr, it.placa || "", false, "nowrap");
      appendTd(tr, it.saida || "", false, "nowrap");
      appendTd(tr, it.chegada || "", false, "nowrap");
      appendTd(tr, it.origem || "", false, "nowrap");
      appendTd(tr, it.destino || "", false, "nowrap");
      appendTd(tr, toFixed1PtBr(it.km || 0), true, "nowrap");
      appendTd(tr, formatCurrency(centsToNumber(freteCent)), true, "nowrap");
      appendTd(tr, it.obs || "", false, "nowrap");

      var tdA = document.createElement("td");
      tdA.style.textAlign = "right";
      applyNoWrap(tdA);

      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn-mini";
      b.textContent = "Remover";

      (function (idx) {
        b.addEventListener("click", function () {
          pontaRemoveExtrato(idx);
        });
      })(i);

      tdA.appendChild(b);
      tr.appendChild(tdA);
      tb.appendChild(tr);
    }

    // Atualiza novamente depois da tabela para garantir os cards mesmo em registros antigos.
    atualizarResumoPonta();
  }

  /* =========================
     FRAC: DESTINOS UI
     ========================= */
  function fracAddDestinoInput(val) {
    if (!elFrac.destinosContainer) return;

    var wrap = document.createElement("div");
    wrap.className = "destino-row";

    var input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Ex.: Bairro / Cidade / Endereço";
    input.value = String(val || "");
    input.addEventListener("blur", scheduleFracAutoRoute);
    input.addEventListener("change", scheduleFracAutoRoute);
    input.addEventListener("input", recalcFracPreview);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-danger";
    btn.textContent = "Remover";

    btn.addEventListener("click", function () {
      try {
        elFrac.destinosContainer.removeChild(wrap);
      } catch (e) {}
      fracSyncDestinosInputs();
      scheduleFracAutoRoute();
    });

    wrap.appendChild(input);
    wrap.appendChild(btn);

    elFrac.destinosContainer.appendChild(wrap);
    fracSyncDestinosInputs();
  }

  function fracSyncDestinosInputs() {
    frac.destinosInputs = [];
    if (!elFrac.destinosContainer) return;

    var inputs = elFrac.destinosContainer.querySelectorAll("input");
    for (var i = 0; i < inputs.length; i++) frac.destinosInputs.push(inputs[i]);
  }

  function fracClearDestinos() {
    if (!elFrac.destinosContainer) return;
    elFrac.destinosContainer.innerHTML = "";
    frac.destinosInputs = [];
  }

  function fracGetDestinosValues() {
    var out = [];
    for (var i = 0; i < frac.destinosInputs.length; i++) {
      var v = String(frac.destinosInputs[i].value || "").trim();
      if (v) out.push(v);
    }
    return out;
  }

  /* =========================
     FRAC: TRECHOS (CARD) ✅ SEM WRAP
     ========================= */
  function renderFracTrechosTable(legs, valorKmNum) {
    var tb = clearTbody(elFrac.tabelaTrechos);
    if (!tb) return;

    if (!legs || !legs.length) {
      var tr0 = document.createElement("tr");
      appendTd(tr0, "-", false, "nowrap");
      appendTd(tr0, "Trechos indisponíveis (calcule a rota).", false, "nowrap");
      appendTd(tr0, "-", true, "nowrap");
      appendTd(tr0, "-", true, "nowrap");
      tb.appendChild(tr0);
      return;
    }

    for (var i = 0; i < legs.length; i++) {
      var leg = legs[i];
      var kmLeg = clampNum(leg.km);
      var valueCent =
        typeof leg.valueCent === "number"
          ? leg.valueCent
          : toCents(kmLeg * valorKmNum);

      var tr = document.createElement("tr");
      appendTd(tr, String(i + 1), false, "nowrap");
      appendTd(tr, cleanLabel(leg.label || ""), false, "nowrap");
      appendTd(tr, toFixed1PtBr(kmLeg), true, "nowrap");
      appendTd(tr, formatCurrency(centsToNumber(valueCent)), true, "nowrap");
      tb.appendChild(tr);
    }
  }

  /* =========================
     FRAC: PREVIEW
     ========================= */
  function recalcFracPreview() {
    var vkm = getValorKmFromUI(elFrac.tipo, elFrac.valorKm);
    var baseCent = 0;

    if (frac.last && frac.last.legs && frac.last.legs.length) {
      for (var i = 0; i < frac.last.legs.length; i++) {
        baseCent += clampNum(frac.last.legs[i].valueCent);
      }
    } else {
      var kmTotal = parseBRLToNumber(elFrac.dist ? elFrac.dist.value : "");
      baseCent = toCents(kmTotal * vkm);
    }

    var carga = parseBRLToNumber(elFrac.carga ? elFrac.carga.value : "");
    var ped = parseBRLToNumber(elFrac.pedagios ? elFrac.pedagios.value : "");
    var out = parseBRLToNumber(elFrac.outros ? elFrac.outros.value : "");
    var margem = parseBRLToNumber(elFrac.margem ? elFrac.margem.value : "");

    var r = calcCustosCent(baseCent, carga, ped, out, margem);

    setText(elFrac.resCustoBase, formatCurrency(centsToNumber(r.baseCent)));
    setText(
      elFrac.resCustosAdicionais,
      formatCurrency(centsToNumber(r.addCent))
    );
    setText(
      elFrac.resCustoTotal,
      formatCurrency(centsToNumber(r.subtotalCent))
    );
    setText(elFrac.resLucro, formatCurrency(centsToNumber(r.lucroCent)));
    setText(elFrac.resFrete, formatCurrency(centsToNumber(r.freteCent)));
  }

  /* =========================
     FRAC: ROTAS + LEGS
     ========================= */
  function geocodeSequencial(nomes) {
    var out = [];
    var chain = Promise.resolve();

    for (var i = 0; i < nomes.length; i++) {
      (function (idx) {
        chain = chain.then(function () {
          return geocodeOne(nomes[idx]).then(function (pt) {
            out[idx] = pt;
          });
        });
      })(i);
    }

    return chain.then(function () {
      return out;
    });
  }

  function fracCalcularRota() {
    var origemTxt = elFrac.origem ? elFrac.origem.value : "";
    var destinos = fracGetDestinosValues();

    if (!String(origemTxt || "").trim()) {
      setText(elFrac.mapStatus, "Status: informe a origem.");
      markFieldInvalid(elFrac.origem);
      return;
    }
    if (!destinos.length) {
      setText(elFrac.mapStatus, "Status: adicione ao menos 1 destino.");
      showToast("Adicione ao menos 1 destino no Fracionado.", "error");
      return;
    }
    if (!validarTipoVeiculo(elFrac, "Fracionado")) {
      setText(elFrac.mapStatus, "Status: selecione o tipo de veículo.");
      return;
    }

    setText(elFrac.mapStatus, "Status: geocodificando na ordem informada...");

    var nomesPontos = [String(origemTxt).trim()].concat(destinos);

    geocodeSequencial(nomesPontos)
      .then(function (pts) {
        setText(
          elFrac.mapStatus,
          "Status: calculando trechos na ordem informada..."
        );

        return fracCalcularLegsPorPares(pts, nomesPontos).then(function (legs) {
          var kmTotal = 0;
          for (var k = 0; k < legs.length; k++) kmTotal += clampNum(legs[k].km);

          if (elFrac.dist) elFrac.dist.value = toFixed1PtBr(kmTotal);

          frac.last.destinos = destinos.slice(0);
          frac.last.legs = legs;
          frac.last.kmTotal = kmTotal;

          var vkm = getValorKmFromUI(elFrac.tipo, elFrac.valorKm);
          renderFracTrechosTable(legs, vkm);
          recalcFracPreview();

          // Desenha o mapa usando os próprios trechos calculados em sequência.
          drawRouteSegments(frac, legs, pts, true);

          setText(
            elFrac.mapStatus,
            "Status: rota fracionada calculada na ordem informada."
          );
        });
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : "falha";
        setText(elFrac.mapStatus, "Status: erro — " + msg);
        showToast("Fracionado: " + msg, "error");

        if (msg.indexOf(origemTxt) >= 0) {
          markFieldInvalid(elFrac.origem);
        } else {
          var destInputs = frac.destinosInputs || [];
          for (var di = 0; di < destInputs.length; di++) {
            var valorDestino = destInputs[di]
              ? String(destInputs[di].value || "").trim()
              : "";

            if (valorDestino && msg.indexOf(valorDestino) >= 0) {
              markFieldInvalid(destInputs[di]);
              break;
            }
          }
        }
      });
  }

  function fracCalcularLegsPorPares(pts, nomesPontos) {
    var legs = [];
    var chain = Promise.resolve();

    for (var i = 0; i < pts.length - 1; i++) {
      (function (idx) {
        chain = chain.then(function () {
          var a = pts[idx];
          var b = pts[idx + 1];
          var fromName =
            nomesPontos && nomesPontos[idx] ? nomesPontos[idx] : "Origem";
          var toName =
            nomesPontos && nomesPontos[idx + 1]
              ? nomesPontos[idx + 1]
              : "Destino";

          // Trecho real em sequência: endereço anterior -> próximo destino informado.
          return osrmRoute([a.lon + "," + a.lat, b.lon + "," + b.lat])
            .then(function (r) {
              var km = clampNum(r.distance) / 1000;
              var vkm = getValorKmFromUI(elFrac.tipo, elFrac.valorKm);

              legs.push({
                km: km,
                label: cleanLabel(fromName + " \u2192 " + toName),
                valueCent: toCents(km * vkm),
                geometry: r.geometry
              });
            })
            .catch(function () {
              var kmEstimado = haversineKm(a, b);
              var vkmEstimado = getValorKmFromUI(elFrac.tipo, elFrac.valorKm);

              legs.push({
                km: kmEstimado,
                label: cleanLabel(fromName + " \u2192 " + toName),
                valueCent: toCents(kmEstimado * vkmEstimado),
                geometry: lineGeometryFromPoints([a, b]),
                estimado: true
              });
            });
        });
      })(i);
    }

    return chain.then(function () {
      return legs;
    });
  }

  /* =========================
     FRAC: EXTRATO (CARD) ✅ SEM WRAP
     ========================= */
  function fracAddExtrato() {
    if (!validarTipoVeiculo(elFrac, "Fracionado")) return;

    var destinos = fracGetDestinosValues();
    var destinosCell = joinDestinos(destinos);

    var vkm = getValorKmFromUI(elFrac.tipo, elFrac.valorKm);
    var kmTotal = parseBRLToNumber(elFrac.dist ? elFrac.dist.value : "");

    var baseCent = 0;
    var legs =
      frac.last && frac.last.legs && frac.last.legs.length
        ? frac.last.legs
        : [];

    if (legs.length) {
      kmTotal = 0;
      for (var i = 0; i < legs.length; i++) {
        kmTotal += clampNum(legs[i].km);
        legs[i].valueCent = toCents(clampNum(legs[i].km) * vkm);
        baseCent += clampNum(legs[i].valueCent);
      }
      if (elFrac.dist) elFrac.dist.value = toFixed1PtBr(kmTotal);
    } else {
      baseCent = toCents(kmTotal * vkm);
    }

    var carga = parseBRLToNumber(elFrac.carga ? elFrac.carga.value : "");
    var ped = parseBRLToNumber(elFrac.pedagios ? elFrac.pedagios.value : "");
    var out = parseBRLToNumber(elFrac.outros ? elFrac.outros.value : "");
    var margem = parseBRLToNumber(elFrac.margem ? elFrac.margem.value : "");

    var r = calcCustosCent(baseCent, carga, ped, out, margem);

    frac.extrato.push({
      tipo: elFrac.tipo ? elFrac.tipo.value : "",
      placa: elFrac.placa ? elFrac.placa.value : "",
      saida: formatDateTimeLocalToBr(elFrac.saida ? elFrac.saida.value : ""),
      chegada: formatDateTimeLocalToBr(
        elFrac.chegada ? elFrac.chegada.value : ""
      ),
      origem: elFrac.origem ? elFrac.origem.value : "",
      destinosTexto: destinosCell,
      km: kmTotal,
      valorKm: vkm,
      freteCent: r.freteCent,
      lucroCent: r.lucroCent,
      obs: elFrac.obs ? elFrac.obs.value : "",
      trechos:
        legs && legs.length
          ? legs.map(function (leg) {
              return {
                km: clampNum(leg.km),
                label: cleanLabel(String(leg.label || "")),
                valueCent:
                  typeof leg.valueCent === "number"
                    ? leg.valueCent
                    : toCents(clampNum(leg.km) * vkm)
              };
            })
          : []
    });

    saveExtratos();
    renderFracExtrato();
  }

  function fracRemoveExtrato(idx) {
    if (idx < 0 || idx >= frac.extrato.length) return;
    frac.extrato.splice(idx, 1);
    saveExtratos();
    renderFracExtrato();
  }

  function fracClearExtrato() {
    frac.extrato = [];
    saveExtratos();
    renderFracExtrato();
  }

  function renderFracExtrato() {
    var totalCent = 0;
    var qtd = frac.extrato.length;
    var qtdTrechos = 0;
    var totalTrechosCent = 0;

    for (var t = 0; t < frac.extrato.length; t++) {
      normalizeExtratoItem(frac.extrato[t]);
      totalCent += getFreteCentValue(frac.extrato[t]);

      var st = getFracTrechosStats(frac.extrato[t]);
      qtdTrechos += st.qtd;
      totalTrechosCent += st.totalCent;
    }

    // No fracionado, a média é dos destinos/trechos, não da viagem inteira.
    // Ex.: trechos 90, 59 e 65 => (90 + 59 + 65) / 3 = 71,33.
    updateResumoExtrato(
      "frac",
      qtd,
      totalCent,
      qtdTrechos || qtd,
      qtdTrechos ? totalTrechosCent : totalCent
    );
    updateFracMediaLabels();

    var tb = getTbodyOrNull(elFrac.tabelaExtrato);
    if (!tb) return;
    tb.innerHTML = "";

    for (var i = 0; i < frac.extrato.length; i++) {
      var it = frac.extrato[i];
      var freteCent = getFreteCentValue(it);

      var tr = document.createElement("tr");
      appendTd(tr, it.tipo || "", false, "nowrap");
      appendTd(tr, it.placa || "", false, "nowrap");
      appendTd(tr, it.saida || "", false, "nowrap");
      appendTd(tr, it.chegada || "", false, "nowrap");
      appendTd(tr, it.origem || "", false, "nowrap");
      appendTd(tr, it.destinosTexto || "", false, "nowrap");
      appendTd(tr, toFixed1PtBr(it.km || 0), true, "nowrap");
      appendTd(tr, formatCurrency(centsToNumber(freteCent)), true, "nowrap");
      appendTd(tr, it.obs || "", false, "nowrap");

      var tdA = document.createElement("td");
      tdA.style.textAlign = "right";
      applyNoWrap(tdA);

      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn-mini";
      b.textContent = "Remover";

      (function (idx) {
        b.addEventListener("click", function () {
          fracRemoveExtrato(idx);
        });
      })(i);

      tdA.appendChild(b);
      tr.appendChild(tdA);
      tb.appendChild(tr);
    }
  }

  /* =========================
     CLEAR CARDS
     ========================= */
  function pontaClearCard() {
    if (elPonta.placa) elPonta.placa.value = "";
    if (elPonta.saida) elPonta.saida.value = "";
    if (elPonta.chegada) elPonta.chegada.value = "";
    if (elPonta.origem) elPonta.origem.value = "";
    if (elPonta.destino) elPonta.destino.value = "";
    if (elPonta.dist) elPonta.dist.value = "";
    if (elPonta.carga) elPonta.carga.value = "";
    if (elPonta.pedagios) elPonta.pedagios.value = "";
    if (elPonta.outros) elPonta.outros.value = "";
    if (elPonta.margem) elPonta.margem.value = "";
    if (elPonta.obs) elPonta.obs.value = "";
    clearRouteOnMap(ponta);
    setText(elPonta.mapStatus, "Status: aguardando origem e destino…");
    recalcPontaPreview();
  }

  function fracClearCard() {
    if (elFrac.placa) elFrac.placa.value = "";
    if (elFrac.saida) elFrac.saida.value = "";
    if (elFrac.chegada) elFrac.chegada.value = "";
    if (elFrac.origem) elFrac.origem.value = "";
    if (elFrac.dist) elFrac.dist.value = "";
    if (elFrac.carga) elFrac.carga.value = "";
    if (elFrac.pedagios) elFrac.pedagios.value = "";
    if (elFrac.outros) elFrac.outros.value = "";
    if (elFrac.margem) elFrac.margem.value = "";
    if (elFrac.obs) elFrac.obs.value = "";

    frac.last = { destinos: [], legs: [], kmTotal: 0 };
    renderFracTrechosTable([], 0);

    clearRouteOnMap(frac);
    setText(elFrac.mapStatus, "Status: aguardando origem e destinos…");
    recalcFracPreview();
  }

  /* =========================
     PDF EXPORT (PONTA)
     ========================= */
  function exportPontaPDF() {
    var JsPDF = ensureJsPDF();
    var doc = new JsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

    pdfAddHeader(doc, "Extrato - Ponta a Ponta");

    var body = [];
    var totalCent = 0;
    var totalKm = 0;
    var totalLucroCent = 0;

    for (var i = 0; i < ponta.extrato.length; i++) {
      var it = normalizeExtratoItem(ponta.extrato[i]) || {};
      var freteCent = getFreteCentValue(it);
      var kmItem = clampNum(it.km);
      var valorKmItem = clampNum(it.valorKm);

      if (!freteCent && kmItem && valorKmItem) {
        freteCent = toCents(kmItem * valorKmItem);
      }

      totalCent += clampNum(freteCent);
      totalKm += kmItem;
      totalLucroCent += clampNum(it.lucroCent);

      body.push([
        String(i + 1),
        pdfSafeText(it.tipo || ""),
        pdfSafeText(it.placa || ""),
        pdfSafeText(it.saida || ""),
        pdfSafeText(it.chegada || ""),
        wrapLongText(pdfSafeText(it.origem || ""), 38),
        wrapLongText(pdfSafeText(it.destino || ""), 38),
        toFixed1PtBr(kmItem),
        formatCurrency(valorKmItem),
        formatCurrency(centsToNumber(freteCent)),
        wrapLongText(pdfSafeText(it.obs || ""), 24)
      ]);
    }

    var qtd = ponta.extrato.length;
    var mediaCent = qtd ? Math.round(totalCent / qtd) : 0;
    var mediaKm = qtd ? totalKm / qtd : 0;

    var y = 72;
    y = pdfSummaryTable(doc, y, [
      [
        "Registros",
        String(qtd),
        "Total de KM",
        toFixed1PtBr(totalKm),
        "Total de Fretes",
        formatCurrency(centsToNumber(totalCent))
      ],
      [
        "Média por Frete",
        formatCurrency(centsToNumber(mediaCent)),
        "Média de KM",
        toFixed1PtBr(mediaKm),
        "Total do Lucro",
        formatCurrency(centsToNumber(totalLucroCent))
      ]
    ]);

    y = pdfSectionTitle(doc, "Lançamentos do histórico", y + 20);

    if (!body.length) {
      body.push([
        "-",
        "-",
        "-",
        "-",
        "-",
        "-",
        "-",
        "-",
        "-",
        "-",
        "Sem registros no histórico."
      ]);
    }

    doc.autoTable({
      startY: y + 6,
      head: [
        [
          "#",
          "Tipo",
          "Placa",
          "Saída",
          "Chegada",
          "Origem",
          "Destino",
          "KM",
          "Valor/KM",
          "Frete",
          "Obs"
        ]
      ],
      body: body,
      theme: "grid",
      margin: { left: 34, right: 34, top: 68, bottom: 42 },
      styles: {
        fontSize: 7.6,
        cellPadding: 3.5,
        overflow: "linebreak",
        valign: "middle",
        cellWidth: "wrap"
      },
      headStyles: {
        fillColor: [20, 93, 81],
        textColor: [255, 255, 255],
        fontStyle: "bold"
      },
      alternateRowStyles: { fillColor: [248, 250, 250] },
      columnStyles: {
        0: { cellWidth: 24, halign: "center" },
        1: { cellWidth: 42 },
        2: { cellWidth: 50 },
        3: { cellWidth: 60 },
        4: { cellWidth: 60 },
        5: { cellWidth: 138 },
        6: { cellWidth: 138 },
        7: { cellWidth: 42, halign: "right" },
        8: { cellWidth: 58, halign: "right" },
        9: { cellWidth: 65, halign: "right", fontStyle: "bold" },
        10: { cellWidth: 60 }
      }
    });

    pdfAddFooter(doc);
    doc.save("EXTRATO_PONTA_A_PONTA_GRUPO_GALVAO.pdf");
  }

  /* =========================
     PDF EXPORT (FRACIONADO)
     ========================= */
  function exportFracPDF() {
    var JsPDF = ensureJsPDF();
    var doc = new JsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

    pdfAddHeader(doc, "Extrato - Frete Fracionado");

    var body = [];
    var totalCent = 0;
    var totalLucroCent = 0;
    var totalKm = 0;
    var qtdTrechosPdf = 0;
    var totalTrechosPdfCent = 0;

    for (var i = 0; i < frac.extrato.length; i++) {
      var it = normalizeExtratoItem(frac.extrato[i]) || {};
      var stPdf = getFracTrechosStats(it);
      var freteCent = getFreteCentValue(it);
      var kmItem = clampNum(it.km);

      totalCent += clampNum(freteCent);
      totalLucroCent += clampNum(it.lucroCent);
      totalKm += kmItem;
      qtdTrechosPdf += stPdf.qtd;
      totalTrechosPdfCent += stPdf.totalCent;

      body.push([
        String(i + 1),
        pdfSafeText(it.tipo || ""),
        pdfSafeText(it.placa || ""),
        pdfSafeText(it.saida || ""),
        pdfSafeText(it.chegada || ""),
        wrapLongText(pdfSafeText(it.origem || ""), 35),
        wrapLongText(pdfSafeText(it.destinosTexto || ""), 42),
        toFixed1PtBr(kmItem),
        formatCurrency(centsToNumber(freteCent)),
        wrapLongText(pdfSafeText(it.obs || ""), 22)
      ]);
    }

    var qtd = frac.extrato.length;
    var divisorPdf = qtdTrechosPdf || qtd;
    var baseMediaPdfCent = qtdTrechosPdf ? totalTrechosPdfCent : totalCent;
    var mediaCent = divisorPdf ? Math.round(baseMediaPdfCent / divisorPdf) : 0;
    var mediaKm = qtdTrechosPdf
      ? totalKm / qtdTrechosPdf
      : qtd
      ? totalKm / qtd
      : 0;

    var y = 72;
    y = pdfSummaryTable(doc, y, [
      [
        "Registros",
        String(qtd),
        "Trechos/Destinos",
        String(qtdTrechosPdf || 0),
        "Total de KM",
        toFixed1PtBr(totalKm)
      ],
      [
        "Total de Fretes",
        formatCurrency(centsToNumber(totalCent)),
        "Média por Destino",
        formatCurrency(centsToNumber(mediaCent)),
        "Total do Lucro",
        formatCurrency(centsToNumber(totalLucroCent))
      ],
      [
        "Média de KM",
        toFixed1PtBr(mediaKm),
        "Base da média",
        qtdTrechosPdf ? "Por trecho/destino" : "Por registro",
        "",
        ""
      ]
    ]);

    y = pdfSectionTitle(doc, "Lançamentos do histórico", y + 20);

    if (!body.length) {
      body.push([
        "-",
        "-",
        "-",
        "-",
        "-",
        "-",
        "-",
        "-",
        "-",
        "Sem registros no histórico."
      ]);
    }

    doc.autoTable({
      startY: y + 6,
      head: [
        [
          "#",
          "Tipo",
          "Placa",
          "Saída",
          "Chegada",
          "Origem",
          "Destinos",
          "KM",
          "Frete",
          "Obs"
        ]
      ],
      body: body,
      theme: "grid",
      margin: { left: 34, right: 34, top: 68, bottom: 42 },
      styles: {
        fontSize: 7.4,
        cellPadding: 3.5,
        overflow: "linebreak",
        valign: "middle",
        cellWidth: "wrap"
      },
      headStyles: {
        fillColor: [20, 93, 81],
        textColor: [255, 255, 255],
        fontStyle: "bold"
      },
      alternateRowStyles: { fillColor: [248, 250, 250] },
      columnStyles: {
        0: { cellWidth: 24, halign: "center" },
        1: { cellWidth: 42 },
        2: { cellWidth: 50 },
        3: { cellWidth: 60 },
        4: { cellWidth: 60 },
        5: { cellWidth: 132 },
        6: { cellWidth: 176 },
        7: { cellWidth: 42, halign: "right" },
        8: { cellWidth: 66, halign: "right", fontStyle: "bold" },
        9: { cellWidth: 56 }
      }
    });

    var currentY = doc.lastAutoTable.finalY + 22;
    var wroteTrechos = false;

    for (var k = 0; k < frac.extrato.length; k++) {
      var reg = frac.extrato[k] || {};
      var trechosArr =
        reg && reg.trechos && reg.trechos.length ? reg.trechos : [];
      if (!trechosArr.length) continue;

      var pageH = doc.internal.pageSize.getHeight();
      if (currentY > pageH - 130) {
        doc.addPage();
        pdfAddHeader(doc, "Extrato - Frete Fracionado");
        currentY = 72;
      }

      if (!wroteTrechos) {
        currentY = pdfSectionTitle(
          doc,
          "Detalhamento dos trechos fracionados",
          currentY
        );
        wroteTrechos = true;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(30, 30, 30);
      doc.text(
        "Registro " +
          (k + 1) +
          " - " +
          pdfSafeText(reg.origem || "") +
          " -> " +
          pdfSafeText(reg.destinosTexto || ""),
        34,
        currentY + 12
      );

      var headT = [["#", "Trecho", "KM", "Valor"]];
      var bodyT = [];
      var valorKmNum =
        reg && typeof reg.valorKm === "number" && !isNaN(reg.valorKm)
          ? reg.valorKm
          : getValorKmByTipo(reg ? reg.tipo : "");

      for (var t = 0; t < trechosArr.length; t++) {
        var leg = trechosArr[t] || {};
        var kmLeg = clampNum(leg.km);
        var vCent =
          leg && typeof leg.valueCent === "number" && isFinite(leg.valueCent)
            ? leg.valueCent
            : toCents(kmLeg * clampNum(valorKmNum));

        bodyT.push([
          String(t + 1),
          wrapLongText(pdfSafeText(leg.label || ""), 74),
          toFixed1PtBr(kmLeg),
          formatCurrency(centsToNumber(vCent))
        ]);
      }

      doc.autoTable({
        startY: currentY + 20,
        head: headT,
        body: bodyT,
        theme: "grid",
        margin: { left: 34, right: 34, top: 68, bottom: 42 },
        styles: {
          fontSize: 7.5,
          cellPadding: 3.2,
          overflow: "linebreak",
          cellWidth: "wrap"
        },
        headStyles: { fillColor: [20, 93, 81], textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [248, 250, 250] },
        columnStyles: {
          0: { cellWidth: 24, halign: "center" },
          1: { cellWidth: 610 },
          2: { cellWidth: 48, halign: "right" },
          3: { cellWidth: 70, halign: "right" }
        }
      });

      currentY = doc.lastAutoTable.finalY + 18;
    }

    pdfAddFooter(doc);
    doc.save("EXTRATO_FRACIONADO_GRUPO_GALVAO.pdf");
  }

  var autoPontaTimer = null;
  var autoFracTimer = null;

  function schedulePontaAutoRoute() {
    clearTimeout(autoPontaTimer);
    autoPontaTimer = setTimeout(function () {
      var origem =
        elPonta && elPonta.origem
          ? String(elPonta.origem.value || "").trim()
          : "";
      var destino =
        elPonta && elPonta.destino
          ? String(elPonta.destino.value || "").trim()
          : "";
      if (origem && destino) pontaCalcularRota();
      else recalcPontaPreview();
    }, 900);
  }

  function scheduleFracAutoRoute() {
    clearTimeout(autoFracTimer);
    autoFracTimer = setTimeout(function () {
      var origem =
        elFrac && elFrac.origem ? String(elFrac.origem.value || "").trim() : "";
      var destinos = fracGetDestinosValues();
      if (origem && destinos.length) fracCalcularRota();
      else recalcFracPreview();
    }, 900);
  }

  /* =========================
     EVENTS
     ========================= */
  function bindEvents() {
    if (themeToggle) themeToggle.addEventListener("click", toggleTheme);

    if (elPonta.tipo)
      elPonta.tipo.addEventListener("change", updateValorKmInputs);

    if (elFrac.tipo)
      elFrac.tipo.addEventListener("change", function () {
        updateValorKmInputs();

        if (frac.last && frac.last.legs && frac.last.legs.length) {
          var vkm = getValorKmFromUI(elFrac.tipo, elFrac.valorKm);
          for (var i = 0; i < frac.last.legs.length; i++) {
            frac.last.legs[i].valueCent = toCents(
              clampNum(frac.last.legs[i].km) * vkm
            );
          }
          renderFracTrechosTable(frac.last.legs, vkm);
          recalcFracPreview();
        }
      });

    if (elPonta.origem) {
      elPonta.origem.addEventListener("blur", schedulePontaAutoRoute);
      elPonta.origem.addEventListener("change", schedulePontaAutoRoute);
    }
    if (elPonta.destino) {
      elPonta.destino.addEventListener("blur", schedulePontaAutoRoute);
      elPonta.destino.addEventListener("change", schedulePontaAutoRoute);
    }
    if (elFrac.origem) {
      elFrac.origem.addEventListener("blur", scheduleFracAutoRoute);
      elFrac.origem.addEventListener("change", scheduleFracAutoRoute);
    }

    // ✅ quando "Outro", recalcula ao digitar o valor/km
    if (elPonta.valorKm)
      elPonta.valorKm.addEventListener("input", function () {
        if (isOutro(elPonta.tipo ? elPonta.tipo.value : ""))
          recalcPontaPreview();
      });

    if (elFrac.valorKm)
      elFrac.valorKm.addEventListener("input", function () {
        if (!isOutro(elFrac.tipo ? elFrac.tipo.value : "")) return;

        var vkm = getValorKmFromUI(elFrac.tipo, elFrac.valorKm);
        if (frac.last && frac.last.legs && frac.last.legs.length) {
          for (var i = 0; i < frac.last.legs.length; i++) {
            frac.last.legs[i].valueCent = toCents(
              clampNum(frac.last.legs[i].km) * vkm
            );
          }
          renderFracTrechosTable(frac.last.legs, vkm);
        }
        recalcFracPreview();
      });

    var pontaFields = [
      elPonta.carga,
      elPonta.pedagios,
      elPonta.outros,
      elPonta.margem,
      elPonta.dist
    ];
    for (var i = 0; i < pontaFields.length; i++) {
      if (pontaFields[i])
        pontaFields[i].addEventListener("input", recalcPontaPreview);
    }

    var fracFields = [
      elFrac.carga,
      elFrac.pedagios,
      elFrac.outros,
      elFrac.margem,
      elFrac.dist
    ];
    for (var j = 0; j < fracFields.length; j++) {
      if (fracFields[j])
        fracFields[j].addEventListener("input", recalcFracPreview);
    }

    if (elPonta.btnRota)
      elPonta.btnRota.addEventListener("click", pontaCalcularRota);
    if (elPonta.btnLimpar)
      elPonta.btnLimpar.addEventListener("click", pontaClearCard);
    if (elPonta.btnAddExtrato)
      elPonta.btnAddExtrato.addEventListener("click", pontaAddExtrato);
    if (elPonta.btnClearExtrato)
      elPonta.btnClearExtrato.addEventListener("click", pontaClearExtrato);
    if (elPonta.btnPdf)
      elPonta.btnPdf.addEventListener("click", exportPontaPDF);

    if (elFrac.btnAddDestino)
      elFrac.btnAddDestino.addEventListener("click", function () {
        fracAddDestinoInput("");
      });

    if (elFrac.btnLimparDestinos)
      elFrac.btnLimparDestinos.addEventListener("click", fracClearDestinos);

    if (elFrac.btnRota)
      elFrac.btnRota.addEventListener("click", fracCalcularRota);
    if (elFrac.btnLimpar)
      elFrac.btnLimpar.addEventListener("click", fracClearCard);
    if (elFrac.btnAddExtrato)
      elFrac.btnAddExtrato.addEventListener("click", fracAddExtrato);
    if (elFrac.btnClearExtrato)
      elFrac.btnClearExtrato.addEventListener("click", fracClearExtrato);
    if (elFrac.btnPdf) elFrac.btnPdf.addEventListener("click", exportFracPDF);

    // Garantia extra para o Ponta a Ponta: após qualquer ação no extrato, recalcula os cards.
    document.addEventListener("click", function (ev) {
      var target = ev && ev.target ? ev.target : null;
      if (!target) return;
      var id = target.id || "";
      var txt = String(target.textContent || "").toLowerCase();
      if (
        id === "ponta_btnAdicionarExtrato" ||
        id === "ponta_btnLimparExtrato" ||
        txt.indexOf("remover") >= 0
      ) {
        setTimeout(atualizarResumoPonta, 0);
        setTimeout(atualizarResumoPonta, 80);
      }
    });
  }

  /* =========================
     INIT
     ========================= */
  function init() {
    loadExtratos();

    initMapPonta();
    initMapFrac();

    // destinos iniciais
    fracAddDestinoInput("");
    fracAddDestinoInput("");
    fracAddDestinoInput("");

    updateValorKmInputs();
    renderPontaExtrato();
    atualizarResumoPonta();
    renderFracExtrato();

    setText(elPonta.mapStatus, "Status: aguardando origem e destino…");
    setText(elFrac.mapStatus, "Status: aguardando origem e destinos…");

    renderFracTrechosTable([], 0);
    recalcPontaPreview();
    recalcFracPreview();

    bindEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
