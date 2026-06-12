const state = {
  data: null,
  confederation: "ALL",
  search: "",
  showBaseline: false,
  fixtures: [],
  fixtureView: "today",
  fixtureSource: "offline",
  fixtureUpdatedAt: null,
};

const LIVE_FIXTURES_URL = "https://worldcup26.ir/get/games";
const FIXTURE_POLL_MS = 30000;
const BRACKET_SLOTS = {
  73: ["2A", "2B"], 74: ["1E", "3A/B/C/D/F"], 75: ["1F", "2C"], 76: ["1C", "2F"],
  77: ["1I", "3C/D/F/G/H"], 78: ["2E", "2I"], 79: ["1A", "3C/E/F/H/I"], 80: ["1L", "3E/H/I/J/K"],
  81: ["1D", "3B/E/F/I/J"], 82: ["1G", "3A/E/H/I/J"], 83: ["2K", "2L"], 84: ["1H", "2J"],
  85: ["1B", "3E/F/G/I/J"], 86: ["1J", "2H"], 87: ["1K", "3D/E/I/J/L"], 88: ["2D", "2G"],
  89: ["W74", "W77"], 90: ["W73", "W75"], 91: ["W76", "W78"], 92: ["W79", "W80"],
  93: ["W83", "W84"], 94: ["W81", "W82"], 95: ["W86", "W88"], 96: ["W85", "W87"],
  97: ["W89", "W90"], 98: ["W93", "W94"], 99: ["W91", "W92"], 100: ["W95", "W96"],
  101: ["W97", "W98"], 102: ["W99", "W100"], 103: ["L101", "L102"], 104: ["W101", "W102"],
};
const ROUND_LABELS = { r32: "Round of 32", r16: "Round of 16", qf: "Quarter-finals", sf: "Semi-finals", final: "Final" };

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
  await loadFixtures();
  window.setInterval(() => loadFixtures(true), FIXTURE_POLL_MS);
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
  byId("simulationLabel").textContent = state.data.simulations >= 1e6
    ? `${(state.data.simulations / 1e6).toFixed(0)}M`
    : `${Math.round(state.data.simulations / 1e3)}K`;
  byId("simulationDescription").textContent = state.data.simulations.toLocaleString();
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
  byId("refreshScores").addEventListener("click", () => loadFixtures());
  document.querySelectorAll(".fixture-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.fixtureView = button.dataset.view;
      document.querySelectorAll(".fixture-tab").forEach((tab) => tab.classList.toggle("active", tab === button));
      renderFixtures();
    });
  });
  document.addEventListener("keydown", (event) => event.key === "Escape" && closeDrawer());
}

function normalizeFixture(game) {
  const id = Number(game.id);
  const slots = BRACKET_SLOTS[id] || ["TBD", "TBD"];
  const elapsed = String(game.time_elapsed || "notstarted").toLowerCase();
  const finished = String(game.finished).toUpperCase() === "TRUE" || elapsed === "finished";
  const live = !finished && elapsed !== "notstarted" && elapsed !== "scheduled";
  return {
    id,
    home: game.home_team_name_en || slots[0],
    away: game.away_team_name_en || slots[1],
    homeScore: Number(game.home_score || 0),
    awayScore: Number(game.away_score || 0),
    group: game.group,
    matchday: game.matchday,
    localDate: game.local_date,
    type: game.type,
    status: finished ? "finished" : live ? "live" : "upcoming",
    elapsed: finished ? "FT" : live ? game.time_elapsed : "Scheduled",
    homeScorers: parseScorers(game.home_scorers),
    awayScorers: parseScorers(game.away_scorers),
  };
}

function parseScorers(value) {
  if (!value || value === "null") return [];
  return String(value).replace(/[{}”“"]/g, "").split(",").map((item) => item.trim()).filter(Boolean);
}

async function loadFixtures(silent = false) {
  if (!silent) setSyncState("loading", "Syncing live scores");
  try {
    const response = await fetch(`${LIVE_FIXTURES_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Live API returned ${response.status}`);
    const payload = await response.json();
    if (!payload.games || payload.games.length !== 104) throw new Error("Incomplete live fixture payload");
    state.fixtures = resolveBracketSlots(payload.games.map(normalizeFixture).sort((a, b) => a.id - b.id));
    state.fixtureSource = "live";
    state.fixtureUpdatedAt = new Date();
    localStorage.setItem("wc26-fixtures-cache", JSON.stringify(payload.games));
    setSyncState("live", "Live scores connected");
  } catch (error) {
    let games = [];
    try {
      const cached = JSON.parse(localStorage.getItem("wc26-fixtures-cache") || "[]");
      if (cached.length === 104) games = cached;
    } catch (_) {}
    if (!games.length) {
      const fallback = await fetch("fixtures-fallback.json").then((response) => response.json());
      games = fallback.games;
    }
    state.fixtures = resolveBracketSlots(games.map(normalizeFixture).sort((a, b) => a.id - b.id));
    state.fixtureSource = "fallback";
    state.fixtureUpdatedAt = new Date();
    setSyncState("error", "Cached scores");
  }
  renderFixtures();
}

function resolveBracketSlots(fixtures) {
  const byMatchId = new Map(fixtures.map((match) => [match.id, match]));
  const resolve = (value) => {
    const reference = /^([WL])(\d+)$/.exec(value);
    if (!reference) return value;
    const source = byMatchId.get(Number(reference[2]));
    if (!source || source.status !== "finished" || source.homeScore === source.awayScore) return value;
    const homeWon = source.homeScore > source.awayScore;
    const winner = homeWon ? source.home : source.away;
    const loser = homeWon ? source.away : source.home;
    return reference[1] === "W" ? winner : loser;
  };
  return fixtures.map((match) => ({
    ...match,
    home: resolve(match.home),
    away: resolve(match.away),
  }));
}

function setSyncState(mode, label) {
  const dot = byId("syncDot");
  dot.className = mode === "live" ? "live" : mode === "error" ? "error" : "";
  byId("syncLabel").textContent = label;
  if (state.fixtureUpdatedAt) {
    byId("lastUpdated").textContent = `Updated ${state.fixtureUpdatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  }
}

function renderFixtures() {
  if (!state.fixtures.length) return;
  const finished = state.fixtures.filter((match) => match.status === "finished").length;
  const live = state.fixtures.filter((match) => match.status === "live").length;
  const goals = state.fixtures.filter((match) => match.status !== "upcoming").reduce((sum, match) => sum + match.homeScore + match.awayScore, 0);
  byId("fixtureSummary").innerHTML = `
    <div class="summary-stat"><span>COMPLETED</span><strong>${finished} / 104</strong></div>
    <div class="summary-stat"><span>LIVE NOW</span><strong>${live}</strong></div>
    <div class="summary-stat"><span>GOALS SCORED</span><strong>${goals}</strong></div>
    <div class="summary-stat"><span>DATA FEED</span><strong>${state.fixtureSource === "live" ? "LIVE" : "CACHED"}</strong></div>`;

  if (state.fixtureView === "bracket") {
    renderBracket();
    return;
  }
  let matches = state.fixtures;
  if (state.fixtureView === "groups") matches = matches.filter((match) => match.type === "group");
  if (state.fixtureView === "today") {
    const today = localDateKey(new Date());
    matches = matches.filter((match) => fixtureDateKey(match) === today);
    if (!matches.length) {
      const next = state.fixtures.find((match) => match.status !== "finished");
      matches = next ? state.fixtures.filter((match) => fixtureDateKey(match) === fixtureDateKey(next)) : [];
    }
  }
  renderFixtureList(matches);
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fixtureDateKey(match) {
  const [datePart] = match.localDate.split(" ");
  const [month, day, year] = datePart.split("/");
  return `${year}-${month}-${day}`;
}

function formatFixtureDate(match) {
  const [datePart] = match.localDate.split(" ");
  const [month, day, year] = datePart.split("/");
  return new Date(`${year}-${month}-${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function renderFixtureList(matches) {
  if (!matches.length) {
    byId("fixtureView").innerHTML = `<div class="empty-fixtures"><strong>No matches here yet.</strong>Try another fixture view.</div>`;
    return;
  }
  const grouped = matches.reduce((days, match) => {
    const key = fixtureDateKey(match);
    (days[key] ||= []).push(match);
    return days;
  }, {});
  byId("fixtureView").innerHTML = `<div class="fixture-list">${Object.values(grouped).map((dayMatches) => `
    <div class="fixture-date-heading">${formatFixtureDate(dayMatches[0])}</div>
    ${dayMatches.map(matchCard).join("")}`).join("")}</div>`;
}

function matchCard(match) {
  const decided = match.status === "finished" && match.homeScore !== match.awayScore;
  const homeClass = decided ? (match.homeScore > match.awayScore ? "winner" : "loser") : "";
  const awayClass = decided ? (match.awayScore > match.homeScore ? "winner" : "loser") : "";
  const time = match.localDate.split(" ")[1] || "";
  const score = match.status === "upcoming"
    ? `<div class="match-score upcoming">${time}</div>`
    : `<div class="match-score"><b>${match.homeScore}</b><span>—</span><b>${match.awayScore}</b></div>`;
  const prediction = predictionFor(match);
  return `<article class="match-card">
    <div class="match-meta"><strong>Match ${match.id}</strong>${match.type === "group" ? `Group ${match.group}` : stageName(match.type)} · venue local</div>
    <div class="match-team home ${homeClass}">${match.home}</div>
    ${score}
    <div class="match-team ${awayClass}">${match.away}</div>
    <div class="match-state"><span class="status-badge ${match.status}">${match.elapsed}</span>${match.status === "finished" ? `<br>${[...match.homeScorers, ...match.awayScorers].slice(0, 2).join(" · ")}` : ""}</div>
    ${prediction ? matchPredictionMarkup(match, prediction) : ""}
  </article>`;
}

function canonicalPredictionTeam(team) {
  const aliases = {
    "Czechia": "Czech Republic",
    "Democratic Republic of the Congo": "DR Congo",
    "Türkiye": "Turkey",
    "USA": "United States",
  };
  return aliases[team] || team;
}

function predictionFor(match) {
  const home = canonicalPredictionTeam(match.home);
  const away = canonicalPredictionTeam(match.away);
  return state.data.match_predictions?.[`${home}|${away}`] || null;
}

function matchPredictionMarkup(match, prediction) {
  const labels = {
    home: canonicalPredictionTeam(match.home),
    draw: "Draw",
    away: canonicalPredictionTeam(match.away),
  };
  return `<div class="match-prediction">
    <span class="prediction-label">MODEL FORECAST</span>
    <strong>Lean ${labels[prediction.outcome]} · modal score ${prediction.home_score}–${prediction.away_score}</strong>
    <div class="prediction-probabilities">
      <span>${canonicalPredictionTeam(match.home)} <b>${fmtPct(prediction.home_win, 0)}</b></span>
      <span>Draw <b>${fmtPct(prediction.draw, 0)}</b></span>
      <span>${canonicalPredictionTeam(match.away)} <b>${fmtPct(prediction.away_win, 0)}</b></span>
    </div>
    <small>xG ${prediction.home_xg.toFixed(2)}–${prediction.away_xg.toFixed(2)}</small>
  </div>`;
}

function stageName(type) {
  return ROUND_LABELS[type] || (type === "third" ? "Third-place match" : "Knockout");
}

function renderBracket() {
  const rounds = ["r32", "r16", "qf", "sf", "final"];
  const columns = rounds.map((type) => {
    const matches = state.fixtures.filter((match) => match.type === type);
    return `<section class="bracket-round">
      <div class="round-heading"><h3>${ROUND_LABELS[type]}</h3><span>${matches.length} ${matches.length === 1 ? "match" : "matches"}</span></div>
      <div class="round-matches">${matches.map(bracketMatch).join("")}</div>
    </section>`;
  }).join("");
  const third = state.fixtures.find((match) => match.type === "third");
  const final = state.fixtures.find((match) => match.type === "final");
  const champion = final?.status === "finished" && final.homeScore !== final.awayScore
    ? (final.homeScore > final.awayScore ? final.home : final.away)
    : "To be decided";
  byId("fixtureView").innerHTML = `<div class="bracket-shell"><div class="bracket">${columns}
    <section class="bracket-round">
      <div class="round-heading"><h3>Podium</h3><span>July 18–19</span></div>
      <div class="round-matches bracket-final-stack">${third ? bracketMatch(third) : ""}<div class="champion-card"><span>WORLD CHAMPION</span><strong>${champion}</strong></div></div>
    </section>
  </div></div>`;
}

function bracketMatch(match) {
  const decided = match.status === "finished" && match.homeScore !== match.awayScore;
  const homeWinner = decided && match.homeScore > match.awayScore;
  const awayWinner = decided && match.awayScore > match.homeScore;
  const scoreVisible = match.status !== "upcoming";
  const prediction = predictionFor(match);
  return `<article class="bracket-match">
    <div class="bracket-meta"><span>M${match.id} · ${match.localDate.split(" ")[0]}</span><span class="${match.status}">${match.elapsed}</span></div>
    <div class="bracket-team ${homeWinner ? "winner" : decided ? "loser" : ""}"><span class="${match.home.includes("/") || /^[WL]\\d/.test(match.home) ? "slot" : ""}">${match.home}</span><b>${scoreVisible ? match.homeScore : "—"}</b></div>
    <div class="bracket-team ${awayWinner ? "winner" : decided ? "loser" : ""}"><span class="${match.away.includes("/") || /^[WL]\\d/.test(match.away) ? "slot" : ""}">${match.away}</span><b>${scoreVisible ? match.awayScore : "—"}</b></div>
    ${prediction ? `<div class="bracket-prediction">MODEL LEAN ${prediction.outcome.toUpperCase()} · MODAL ${prediction.home_score}–${prediction.away_score} · ${fmtPct(Math.max(prediction.home_win, prediction.draw, prediction.away_win), 0)}</div>` : ""}
  </article>`;
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
