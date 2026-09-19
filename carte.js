// Vue "Carte" de la Visualisation : un point par collaborateur localisé (adresse de mission),
// regroupés en gros points quand ils se chevauchent. Lit l'état déjà fusionné par app.js
// (window.CartoApp) et se recale à chaque changement de filtre (window.CartoMap.refresh).
(function () {
  "use strict";

  const IDF_BOUNDS = { latMin: 48.1, latMax: 49.25, lonMin: 1.4, lonMax: 3.6 };
  const IDF_CENTER = [48.8566, 2.3522];
  const ROLE_LABELS = { SM: "Senior Manager", Manager: "Manager", CP: "Chef / Directeur de projet", Consultant: "Consultant" };
  const ROLE_ORDER = ["SM", "Manager", "CP", "Consultant"];
  const MAX_NAMES_IN_CLUSTER_TIP = 14;

  const esc = (v) =>
    String(v === undefined || v === null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const els = {
    tabs: document.getElementById("viz-tabs"),
    search: document.getElementById("search"),
    unlocatedTitle: document.getElementById("map-unlocated-title"),
    unlocatedList: document.getElementById("map-unlocated"),
    mapDiv: document.getElementById("map"),
  };

  let map = null;
  let cluster = null;
  let markersById = new Map();
  let active = false; // vue Carte affichée ?
  let graphStats = "";

  const roleKey = (c) => CartoApp.roleOf(c.poste) || "Consultant";
  const isLocated = (c) => typeof c.lat === "number" && typeof c.lon === "number";

  function inScope(c, f) {
    if (f.compte && c.compte_reference !== f.compte) return false;
    if (f.sm && c.id !== f.sm && c.senior_manager_id !== f.sm) return false;
    return true;
  }

  function ensureMap() {
    if (map) return true;
    if (typeof L === "undefined" || !L.markerClusterGroup) {
      els.mapDiv.innerHTML =
        '<div style="padding:24px;color:var(--text-muted)">La carte n\'a pas pu être chargée (bibliothèque Leaflet injoignable). Vérifie ta connexion.</div>';
      return false;
    }
    map = L.map("map").setView(IDF_CENTER, 10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© contributeurs OpenStreetMap",
    }).addTo(map);

    cluster = L.markerClusterGroup({
      maxClusterRadius: 45,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true, // même adresse exacte : les points s'ouvrent en éventail au clic
      iconCreateFunction: (cl) => {
        const n = cl.getChildCount();
        const size = Math.round(30 + Math.min(34, Math.sqrt(n) * 5));
        const counts = alertCounts(cl.getAllChildMarkers());
        const worst = counts.gap ? "gap" : counts.referent ? "referent" : "";
        const badge = worst ? `<span class="map-alert map-alert-${worst}">${ALERT_GLYPH}</span>` : "";
        return L.divIcon({
          html: `<div class="mc-cluster" style="width:${size}px;height:${size}px;font-size:${size > 44 ? 15 : 13}px">${n}</div>${badge}`,
          className: "",
          iconSize: [size, size],
        });
      },
    });
    cluster.on("clustermouseover", (e) => {
      e.layer.unbindTooltip();
      e.layer.bindTooltip(clusterTooltipHtml(e.layer.getAllChildMarkers()), { className: "carto-tip", direction: "top" }).openTooltip();
    });
    map.addLayer(cluster);
    return true;
  }

  function alertCounts(markers) {
    const counts = { gap: 0, referent: 0 };
    markers.forEach((m) => {
      if (m.options.followUp === "gap") counts.gap++;
      else if (m.options.followUp === "referent") counts.referent++;
    });
    return counts;
  }

  function clusterTooltipHtml(markers) {
    const collabs = markers.map((m) => m.options.collab);
    const byRole = {};
    collabs.forEach((c) => (byRole[roleKey(c)] = (byRole[roleKey(c)] || 0) + 1));
    const breakdown = ROLE_ORDER.filter((r) => byRole[r])
      .map((r) => `${byRole[r]} ${ROLE_LABELS[r]}${byRole[r] > 1 && r !== "CP" ? "s" : ""}`)
      .join(", ");
    const counts = alertCounts(markers);
    // Les personnes en alerte s'affichent dans la couleur de leur alerte. Si la liste est
    // tronquée, elles passent en priorité pour ne jamais être masquées.
    const people = markers
      .map((m) => ({ name: CartoApp.collabName(m.options.collab), status: m.options.followUp }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const flagged = people.filter((p) => p.status === "gap" || p.status === "referent");
    const others = people.filter((p) => !flagged.includes(p)).slice(0, Math.max(0, MAX_NAMES_IN_CLUSTER_TIP - flagged.length));
    const shown = [...flagged, ...others].sort((a, b) => a.name.localeCompare(b.name));
    const rest = people.length - shown.length;
    const namesHtml = shown
      .map((p) => (p.status === "gap" || p.status === "referent" ? `<span class="map-name-${p.status}">${esc(p.name)}</span>` : esc(p.name)))
      .join(", ");
    return `
      <div class="tt-title">${collabs.length} personnes</div>
      <div class="tt-sub">${esc(breakdown)}</div>
      <div>${namesHtml}${rest > 0 ? ` et ${rest} autre(s)` : ""}</div>
      ${counts.gap ? `<div class="tt-row map-tip-alert map-tip-alert-gap">${ALERT_GLYPH} ${counts.gap} sans réunion commune avec un responsable</div>` : ""}
      ${counts.referent ? `<div class="tt-row map-tip-alert map-tip-alert-referent">${ALERT_GLYPH} ${counts.referent} suivi(s) uniquement par un consultant référent</div>` : ""}`;
  }

  function markerTooltipHtml(c, status) {
    return `
      <div class="tt-title">${esc(CartoApp.collabName(c))}</div>
      <div class="tt-sub">${esc(c.poste || "Poste non précisé")}</div>
      ${c.compte_reference ? `<div class="tt-row"><span class="tt-label">Compte de référence :</span> ${esc(c.compte_reference)}</div>` : ""}
      <div class="tt-row"><span class="tt-label">Adresse de mission :</span> ${esc(c.adresse_mission)}</div>
      ${CartoApp.tagPillsHtml(c.tags)}
      ${status === "gap" ? `<div class="tt-row map-tip-alert map-tip-alert-gap">${ALERT_GLYPH} ${ALERT_TEXT.gap}</div>` : ""}
      ${status === "referent" ? `<div class="tt-row map-tip-alert map-tip-alert-referent">${ALERT_GLYPH} ${ALERT_TEXT.referent}</div>` : ""}`;
  }

  const ALERT_GLYPH = "\u26A0\uFE0E"; // U+FE0E : force le rendu texte (colorable), pas l'emoji
  const ALERT_TEXT = {
    gap: "Aucune réunion commune avec un responsable (SM/Manager/CP)",
    referent: "Réunion commune uniquement avec son consultant référent (aucune avec SM/Manager/CP)",
  };

  function buildMarker(c) {
    const role = roleKey(c);
    const status = CartoApp.followUpStatus(c); // "ok" | "referent" | "gap"
    const fragile = c.tags.includes("En fragilité");
    const d = role === "SM" ? 22 : role === "Consultant" ? 16 : 19;
    const dotColor = CartoApp.cssVar(CartoApp.roleColorVar(CartoApp.roleOf(c.poste)));
    const ring = fragile ? CartoApp.cssVar("--ring-fragile") : "#ffffff";
    const badge = status === "ok" ? "" : `<span class="map-alert map-alert-${status}">${ALERT_GLYPH}</span>`;
    const m = L.marker([c.lat, c.lon], {
      icon: L.divIcon({
        className: "",
        iconSize: [d, d],
        html: `<div class="map-dot" style="width:${d}px;height:${d}px;background:${dotColor};border:${fragile ? 3.5 : 2}px solid ${ring}"></div>${badge}`,
      }),
      collab: c,
      followUp: status,
    });
    m.bindTooltip(markerTooltipHtml(c, status), { className: "carto-tip", direction: "top", offset: [0, -d / 2] });
    return m;
  }

  function isInIdf(c) {
    return c.lat >= IDF_BOUNDS.latMin && c.lat <= IDF_BOUNDS.latMax && c.lon >= IDF_BOUNDS.lonMin && c.lon <= IDF_BOUNDS.lonMax;
  }

  function draw() {
    if (!ensureMap()) return;
    const f = CartoApp.getFilters();
    const scoped = CartoApp.getCollabs().filter((c) => inScope(c, f));
    const located = scoped.filter(isLocated);
    const unlocated = scoped.filter((c) => !isLocated(c));

    cluster.clearLayers();
    markersById = new Map();
    const markers = located.map((c) => {
      const m = buildMarker(c);
      markersById.set(c.id, m);
      return m;
    });
    cluster.addLayers(markers);

    const inIdf = located.filter(isInIdf);
    if (inIdf.length) {
      map.fitBounds(L.latLngBounds(inIdf.map((c) => [c.lat, c.lon])), { padding: [40, 40], maxZoom: 13 });
    } else {
      map.setView(IDF_CENTER, 10);
    }

    els.unlocatedTitle.textContent = `Non localisés (${unlocated.length})`;
    els.unlocatedList.innerHTML = unlocated
      .slice()
      .sort((a, b) => CartoApp.collabName(a).localeCompare(CartoApp.collabName(b)))
      .map(
        (c) =>
          `<li>${esc(CartoApp.collabName(c))} <small>${c.adresse_mission ? "adresse non localisée" : "pas d'adresse"}</small></li>`
      )
      .join("");

    const nbGap = located.filter((c) => CartoApp.followUpStatus(c) === "gap").length;
    const nbRef = located.filter((c) => CartoApp.followUpStatus(c) === "referent").length;
    if (active) {
      CartoApp.setStatsText(
        `${located.length} localisé(s) · ${unlocated.length} non localisé(s)` +
          (nbGap ? ` · ${ALERT_GLYPH} ${nbGap} sans réunion commune avec un responsable` : "") +
          (nbRef ? ` · ${ALERT_GLYPH} ${nbRef} suivi(s) uniquement par un consultant référent` : "")
      );
    }
  }

  function setView(view) {
    active = view === "carte";
    document.body.classList.toggle("view-carte", active);
    els.tabs.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("current", b.dataset.view === view));
    if (active) {
      graphStats = CartoApp.getStatsText();
      els.search.placeholder = "Rechercher un collaborateur...";
      draw(); // recalé à chaque affichage : les données ont pu changer pendant que la vue était masquée
      if (map) map.invalidateSize();
      if (els.search.value.trim()) onSearch();
    } else {
      els.search.placeholder = "Rechercher un collaborateur ou une réunion...";
      CartoApp.setStatsText(graphStats);
      window.dispatchEvent(new Event("resize")); // vis-network se redimensionne sur cet évènement
    }
  }

  function onSearch() {
    if (!active || !map) return;
    const q = els.search.value.trim().toLowerCase();
    if (!q) return;
    const hits = [...markersById.values()].filter((m) => CartoApp.collabName(m.options.collab).toLowerCase().includes(q));
    if (!hits.length) return;
    if (hits.length === 1) {
      cluster.zoomToShowLayer(hits[0], () => hits[0].openTooltip());
    } else {
      map.fitBounds(L.latLngBounds(hits.map((m) => m.getLatLng())), { padding: [60, 60], maxZoom: 14 });
    }
  }

  els.tabs.addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (b) setView(b.dataset.view);
  });
  els.search.addEventListener("input", onSearch);

  window.CartoMap = {
    // Appelé par app.js après chaque reconstruction (chargement, filtres, toggles).
    refresh() {
      if (active) draw();
    },
  };
})();
