from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import date
from math import log1p

import numpy as np
import pandas as pd


ALIASES = {
    "USA": "United States",
    "Türkiye": "Turkey",
    "Czechia": "Czech Republic",
}

FEATURE_COLUMNS = [
    "elo_diff",
    "win_rate_diff",
    "draw_rate_diff",
    "goals_for_diff",
    "goals_against_diff",
    "goal_difference_diff",
    "experience_diff",
    "home_edge",
    "neutral",
    "competitive",
]


def canonical_team(name: str) -> str:
    return ALIASES.get(name.strip(), name.strip())


@dataclass(slots=True)
class TeamState:
    elo: float = 1500.0
    matches: int = 0
    recent: deque[tuple[float, float, float]] = field(
        default_factory=lambda: deque(maxlen=10)
    )

    def summary(self) -> tuple[float, float, float, float]:
        if not self.recent:
            return 0.33, 0.34, 1.2, 1.2
        wins = sum(result for result, _, _ in self.recent) / len(self.recent)
        draws = sum(result == 0.5 for result, _, _ in self.recent) / len(self.recent)
        goals_for = sum(gf for _, gf, _ in self.recent) / len(self.recent)
        goals_against = sum(ga for _, _, ga in self.recent) / len(self.recent)
        return wins, draws, goals_for, goals_against


def is_competitive(tournament: str) -> float:
    value = tournament.lower()
    return 0.0 if "friendly" in value else 1.0


def feature_vector(
    home: TeamState,
    away: TeamState,
    *,
    neutral: bool,
    competitive: bool,
    home_is_host: bool = False,
    away_is_host: bool = False,
) -> list[float]:
    home_win, home_draw, home_gf, home_ga = home.summary()
    away_win, away_draw, away_gf, away_ga = away.summary()
    if neutral:
        home_edge = 80.0 * float(home_is_host) - 80.0 * float(away_is_host)
    else:
        home_edge = 80.0
    return [
        home.elo - away.elo + home_edge,
        home_win - away_win,
        home_draw - away_draw,
        home_gf - away_gf,
        home_ga - away_ga,
        (home_gf - home_ga) - (away_gf - away_ga),
        log1p(home.matches) - log1p(away.matches),
        home_edge,
        float(neutral),
        float(competitive),
    ]


def build_match_features(
    matches: pd.DataFrame,
) -> tuple[pd.DataFrame, dict[str, TeamState]]:
    frame = matches.copy()
    frame["date"] = pd.to_datetime(frame["date"])
    frame = frame.sort_values(["date", "home_team", "away_team"]).reset_index(drop=True)
    states: defaultdict[str, TeamState] = defaultdict(TeamState)
    records: list[dict[str, object]] = []

    for row in frame.itertuples(index=False):
        home_name = canonical_team(str(row.home_team))
        away_name = canonical_team(str(row.away_team))
        home = states[home_name]
        away = states[away_name]
        neutral = str(row.neutral).lower() == "true"
        competitive = bool(is_competitive(str(row.tournament)))
        values = feature_vector(
            home, away, neutral=neutral, competitive=competitive
        )
        home_score = int(row.home_score)
        away_score = int(row.away_score)
        if home_score > away_score:
            outcome = 2
            home_result, away_result = 1.0, 0.0
        elif home_score < away_score:
            outcome = 0
            home_result, away_result = 0.0, 1.0
        else:
            outcome = 1
            home_result = away_result = 0.5

        record = dict(zip(FEATURE_COLUMNS, values))
        record.update(
            {
                "date": row.date,
                "home_team": home_name,
                "away_team": away_name,
                "tournament": row.tournament,
                "home_score": home_score,
                "away_score": away_score,
                "outcome": outcome,
            }
        )
        records.append(record)

        expected_home = 1.0 / (1.0 + 10 ** (-(values[0]) / 400.0))
        margin = abs(home_score - away_score)
        goal_multiplier = 1.0 + min(margin, 4) * 0.25
        k = (28.0 if competitive else 14.0) * goal_multiplier
        delta = k * (home_result - expected_home)
        home.elo += delta
        away.elo -= delta
        home.matches += 1
        away.matches += 1
        home.recent.append((home_result, home_score, away_score))
        away.recent.append((away_result, away_score, home_score))

    return pd.DataFrame.from_records(records), dict(states)


def load_completed_matches(path: str) -> pd.DataFrame:
    matches = pd.read_csv(path)
    required = {
        "date",
        "home_team",
        "away_team",
        "home_score",
        "away_score",
        "tournament",
        "neutral",
    }
    missing = required - set(matches.columns)
    if missing:
        raise ValueError(f"Missing match columns: {sorted(missing)}")
    matches = matches.dropna(subset=["home_score", "away_score"]).copy()
    matches["home_score"] = pd.to_numeric(matches["home_score"], errors="coerce")
    matches["away_score"] = pd.to_numeric(matches["away_score"], errors="coerce")
    matches = matches.dropna(subset=["home_score", "away_score"])
    matches = matches[
        (matches["home_score"] >= 0)
        & (matches["away_score"] >= 0)
        & (matches["date"] <= date.today().isoformat())
    ].copy()
    return matches.drop_duplicates(
        subset=["date", "home_team", "away_team", "home_score", "away_score"]
    )


def as_matrix(frame: pd.DataFrame) -> np.ndarray:
    return frame[FEATURE_COLUMNS].to_numpy(dtype=float)


def apply_current_elo(states: dict[str, TeamState], path: str) -> int:
    ratings = pd.read_csv(path)
    ratings["snapshot_date"] = pd.to_datetime(ratings["snapshot_date"])
    cutoff = pd.Timestamp(date.today())
    valid = ratings[ratings["snapshot_date"] <= cutoff].copy()
    valid["country"] = valid["country"].map(canonical_team)
    latest = (
        valid.sort_values("snapshot_date")
        .drop_duplicates("country", keep="last")
    )
    updated = 0
    for row in latest.itertuples(index=False):
        if row.country in states:
            states[row.country].elo = float(row.rating)
            updated += 1
    return updated
