const state = {
  data: null,
  confederation: "ALL",
  search: "",
  showBaseline: false,
};

const fmtPct = (value, digits = 2) => `${(value * 100).toFixed(digits)}%`;
const fmtMoney = (value) => value >= 1e9 ? `€${(value / 1e9).toFixed(2)}B` : `€${Math.round(value / 1e6)}M`;
const byId = (id) => document.getElementById(id);

async function init() {
  state.data = await fetch("data.json").then((response) => response.json());
  renderHero();
  renderTicker();
  renderFilters();
  renderForecast();
  renderSquads();
  renderGroups();
  renderBacktests();
  bindEvents();
}

function filteredTeams() {
  return state.data.teams.filter((team) => {
    const confedMatch = state.confederation === "ALL" || team.confederation === state.confederation;
    const searchMatch = team.team.toLowerCase().includes(state.search.toLowerCase());
    return confedMatch && searchMatch;
  });
}

function renderHero() {
  const winner = state.data.teams[0];
  byId("heroWinner").textContent = winner.team;
  byId("heroProbability").innerHTML = `${(winner.probability * 100).toFixed(2)}<span>%</span>`;
  byId("heroSquad").textContent = `${winner.fc26_depth_rating.toFixed(2)} squad`;
  byId("heroElo").textContent = `${winner.elo} Elo`;
}

function renderTicker() {
  const items = state.data.teams.slice(0, 10).map((team) =>
    `<div class="ticker-item"><i></i><span>${String(team.rank).padStart(2, "0")} ${team.team}</span><strong>${fmtPct(team.probability)}</strong></div>`
  ).join("");
  byId("tickerTrack").innerHTML = items + items;
}

function renderFilters() {
  const confederations = ["ALL", ...new Set(state.data.teams.map((team) => team.confederation))];
  byId("confederationFilters").innerHTML = confederations.map((confed) =>
    `<button class="filter-button ${confed === state.confederation ? "active" : ""}" data-confed="${confed}">${confed}</button>`
  ).join("");
  document.querySelectorAll(".filter-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.confederation = button.dataset.confed;
      renderFilters();
      renderForecast();
    });
  });
}

function renderForecast() {
  const teams = filteredTeams();
  const chartTeams = teams.slice(0, 12);
  const max = Math.max(...chartTeams.map((team) => team.probability), 0.01);
  byId("visibleCount").textContent = `${teams.length} teams`;

  byId("probabilityChart").innerHTML = chartTeams.length ? chartTeams.map((team) => {
    const width = team.probability / max * 100;
    const baselinePosition = team.baseline_probability / max * 100;
    return `<div class="bar-row" data-team="${team.team}">
      <span class="bar-rank">${String(team.rank).padStart(2, "0")}</span>
      <span class="bar-team">${team.team}</span>
      <div class="bar-track">
        <div class="bar-fill" style="width:${width}%"></div>
        ${state.showBaseline ? `<div class="baseline-marker" style="left:${Math.min(baselinePosition, 100)}%"></div>` : ""}
      </div>
      <span class="bar-value">${fmtPct(team.probability)}</span>
    </div>`;
  }).join("") : `<p class="mono">No nations match this filter.</p>`;

  byId("rankingTable").innerHTML = teams.map((team) => {
    const direction = team.change > .0001 ? "up" : team.change < -.0001 ? "down" : "";
    const sign = team.change > 0 ? "+" : "";
    return `<div class="ranking-row" data-team="${team.team}">
      <span class="rank">${String(team.rank).padStart(2, "0")}</span>
      <span class="team-cell"><strong>${team.team}</strong><small>${team.confederation} · Group ${team.group}</small></span>
      <span class="change ${direction}">${sign}${(team.change * 100).toFixed(2)} pp</span>
      <span class="prob">${fmtPct(team.probability)}</span>
    </div>`;
  }).join("");
  bindTeamClicks();
}

function renderSquads() {
  const squadLeader = [...state.data.teams].sort((a, b) => b.squad_score_z - a.squad_score_z)[0];
  byId("squadSpotlight").innerHTML = `
    <div><span class="spot-rank">#01 SQUAD INDEX</span><h3>${squadLeader.team}</h3></div>
    <div class="spotlight-score">${squadLeader.fc26_depth_rating.toFixed(1)} <small>/ 100 depth</small></div>
    <div class="spotlight-stats">
      <div><span>STARTING XI</span><strong>${squadLeader.fc26_xi_rating.toFixed(1)}</strong></div>
      <div><span>ELITE PLAYERS</span><strong>${squadLeader.elite_players}</strong></div>
      <div><span>MARKET DEPTH</span><strong>${fmtMoney(squadLeader.market_value_top26_eur)}</strong></div>
      <div><span>MODEL BOOST</span><strong>+${squadLeader.squad_elo_adjustment.toFixed(1)} Elo</strong></div>
    </div>`;
  renderScatter();
}

function renderScatter() {
  const teams = state.data.teams;
  const width = 760, height = 370, margin = { top: 20, right: 30, bottom: 40, left: 48 };
  const eloValues = teams.map((t) => t.elo);
  const squadValues = teams.map((t) => t.fc26_depth_rating);
  const minX = Math.min(...eloValues) - 30, maxX = Math.max(...eloValues) + 30;
  const minY = Math.min(...squadValues) - 2, maxY = Math.max(...squadValues) + 2;
  const x = (value) => margin.left + (value - minX) / (maxX - minX) * (width - margin.left - margin.right);
  const y = (value) => height - margin.bottom - (value - minY) / (maxY - minY) * (height - margin.top - margin.bottom);
  const radius = (probability) => 3 + Math.sqrt(probability) * 18;

  const grid = [0, .25, .5, .75, 1].map((step) => {
    const gx = margin.left + step * (width - margin.left - margin.right);
    const gy = margin.top + step * (height - margin.top - margin.bottom);
    return `<line class="scatter-axis" x1="${gx}" y1="${margin.top}" x2="${gx}" y2="${height - margin.bottom}"/>
      <line class="scatter-axis" x1="${margin.left}" y1="${gy}" x2="${width - margin.right}" y2="${gy}"/>`;
  }).join("");
  const dots = teams.map((team) =>
    `<circle class="scatter-dot" data-team="${team.team}" cx="${x(team.elo)}" cy="${y(team.fc26_depth_rating)}" r="${radius(team.probability)}">
      <title>${team.team}: ${fmtPct(team.probability)}, ${team.elo} Elo, ${team.fc26_depth_rating.toFixed(1)} depth</title>
    </circle>`
  ).join("");
  const labels = teams.slice(0, 7).map((team) =>
    `<text class="scatter-label" x="${x(team.elo) + radius(team.probability) + 3}" y="${y(team.fc26_depth_rating) + 3}">${team.team}</text>`
  ).join("");
  byId("scatterPlot").innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Elo versus squad depth scatter plot">
    ${grid}${dots}${labels}
    <text class="scatter-label" x="${width / 2}" y="${height - 8}">CURRENT ELO →</text>
    <text class="scatter-label" transform="rotate(-90 11 ${height / 2})" x="11" y="${height / 2}">SQUAD DEPTH →</text>
  </svg>`;
  bindTeamClicks();
}

function renderGroups() {
  const groups = [...new Set(state.data.teams.map((team) => team.group))].sort();
  byId("groupGrid").innerHTML = groups.map((group) => {
    const teams = state.data.teams.filter((team) => team.group === group).sort((a, b) => b.probability - a.probability);
    return `<article class="group-card">
      <h3>GROUP ${group}</h3>
      ${teams.map((team, index) => `<div class="group-team" data-team="${team.team}">
        <span class="seed">${String(index + 1).padStart(2, "0")}</span>
        <strong>${team.team}</strong>
        <span>${fmtPct(team.probability)}</span>
      </div>`).join("")}
    </article>`;
  }).join("");
  bindTeamClicks();
}

function renderBacktests() {
  byId("backtestStrip").innerHTML = state.data.backtests.map((test) =>
    `<div class="backtest-item"><span>${test.world_cup} WORLD CUP</span><strong>${(test.accuracy * 100).toFixed(1)}% accuracy</strong></div>
     <div class="backtest-item"><span>MODEL LOG LOSS</span><strong>${test.log_loss.toFixed(3)}</strong></div>
     <div class="backtest-item"><span>NAIVE BASELINE</span><strong>${test.baseline_log_loss.toFixed(3)}</strong></div>`
  ).join("");
}

function bindEvents() {
  byId("teamSearch").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderForecast();
  });
  byId("baselineToggle").addEventListener("change", (event) => {
    state.showBaseline = event.target.checked;
    renderForecast();
  });
  byId("methodButton").addEventListener("click", () => byId("method").scrollIntoView({ behavior: "smooth" }));
  byId("drawerClose").addEventListener("click", closeDrawer);
  byId("drawerBackdrop").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => event.key === "Escape" && closeDrawer());
}

function bindTeamClicks() {
  document.querySelectorAll("[data-team]").forEach((element) => {
    element.addEventListener("click", () => openDrawer(element.dataset.team));
  });
}

function openDrawer(teamName) {
  const team = state.data.teams.find((item) => item.team === teamName);
  const delta = team.change * 100;
  byId("drawerContent").innerHTML = `
    <span class="drawer-kicker">RANK ${String(team.rank).padStart(2, "0")} · GROUP ${team.group} · ${team.confederation}</span>
    <h2 class="drawer-title">${team.team}</h2>
    <div class="drawer-prob">${(team.probability * 100).toFixed(2)}<small>%</small></div>
    <div class="drawer-grid">
      <div class="drawer-stat"><span>CURRENT ELO</span><strong>${team.elo}</strong></div>
      <div class="drawer-stat"><span>FIFA RANK</span><strong>#${team.fifa_rank}</strong></div>
      <div class="drawer-stat"><span>STARTING XI</span><strong>${team.fc26_xi_rating.toFixed(1)}</strong></div>
      <div class="drawer-stat"><span>26-MAN DEPTH</span><strong>${team.fc26_depth_rating.toFixed(1)}</strong></div>
      <div class="drawer-stat"><span>ELITE PLAYERS</span><strong>${team.elite_players}</strong></div>
      <div class="drawer-stat"><span>SQUAD VALUE</span><strong>${fmtMoney(team.market_value_top26_eur)}</strong></div>
      <div class="drawer-stat"><span>SQUAD EFFECT</span><strong>${delta >= 0 ? "+" : ""}${delta.toFixed(2)} pp</strong></div>
      <div class="drawer-stat"><span>SIMULATED TITLES</span><strong>${team.simulated_titles.toLocaleString()}</strong></div>
    </div>
    <p class="drawer-note"><strong>Coach:</strong> ${team.coach}<br><strong>Best World Cup result:</strong> ${team.best_wc_result}<br><br>This estimate combines historical team performance with current squad quality. It is a probability, not a promise.</p>`;
  byId("teamDrawer").classList.add("open");
  byId("drawerBackdrop").classList.add("open");
  byId("teamDrawer").setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  byId("teamDrawer").classList.remove("open");
  byId("drawerBackdrop").classList.remove("open");
  byId("teamDrawer").setAttribute("aria-hidden", "true");
}

init().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<main style="padding:40px;color:white"><h1>Dashboard data could not load.</h1><p>${error.message}</p></main>`;
});

