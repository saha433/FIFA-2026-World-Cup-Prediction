from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from itertools import combinations
from math import exp, factorial

import numpy as np
import pandas as pd

from .features import TeamState, canonical_team, feature_vector
from .training import ModelBundle


HOSTS = {"Canada", "Mexico", "United States"}


@dataclass(slots=True)
class Standing:
    team: str
    points: int = 0
    goals_for: int = 0
    goals_against: int = 0

    @property
    def goal_difference(self) -> int:
        return self.goals_for - self.goals_against


@dataclass(frozen=True, slots=True)
class MatchPrediction:
    home_team: str
    away_team: str
    home_win_probability: float
    draw_probability: float
    away_win_probability: float
    expected_home_goals: float
    expected_away_goals: float
    predicted_home_score: int
    predicted_away_score: int

    @property
    def predicted_outcome(self) -> str:
        probabilities = {
            "home": self.home_win_probability,
            "draw": self.draw_probability,
            "away": self.away_win_probability,
        }
        return max(probabilities, key=probabilities.get)

    def as_record(self) -> dict[str, object]:
        return {
            "home_team": self.home_team,
            "away_team": self.away_team,
            "home_win_probability": self.home_win_probability,
            "draw_probability": self.draw_probability,
            "away_win_probability": self.away_win_probability,
            "expected_home_goals": self.expected_home_goals,
            "expected_away_goals": self.expected_away_goals,
            "predicted_home_score": self.predicted_home_score,
            "predicted_away_score": self.predicted_away_score,
            "predicted_outcome": self.predicted_outcome,
        }


def load_groups(path: str) -> dict[str, list[str]]:
    teams = pd.read_csv(path)
    groups: dict[str, list[str]] = defaultdict(list)
    for row in teams.itertuples(index=False):
        groups[str(row.group)].append(canonical_team(str(row.team)))
    if set(groups) != set("ABCDEFGHIJKL") or any(
        len(teams_in_group) != 4 for teams_in_group in groups.values()
    ):
        raise ValueError("Expected 12 groups of four teams")
    return dict(groups)


class WorldCupSimulator:
    def __init__(
        self,
        bundle: ModelBundle,
        groups: dict[str, list[str]],
        elo_adjustments: dict[str, float] | None = None,
    ) -> None:
        self.bundle = bundle
        self.groups = groups
        self.elo_adjustments = elo_adjustments or {}
        self._prediction_cache: dict[
            tuple[str, str], tuple[float, float, np.ndarray]
        ] = {}

    def _state(self, team: str) -> TeamState:
        if team not in self.bundle.states:
            raise KeyError(f"No historical state found for {team}")
        return self.bundle.states[team]

    def _features(self, home: str, away: str) -> np.ndarray:
        values = feature_vector(
            self._state(home),
            self._state(away),
            neutral=True,
            competitive=True,
            home_is_host=home in HOSTS,
            away_is_host=away in HOSTS,
        )
        values[0] += self.elo_adjustments.get(
            home, 0.0
        ) - self.elo_adjustments.get(away, 0.0)
        return np.asarray([values], dtype=float)

    def _strength(self, team: str) -> float:
        return self._state(team).elo + self.elo_adjustments.get(team, 0.0)

    def score(self, home: str, away: str, rng: np.random.Generator) -> tuple[int, int]:
        home_mu, away_mu, _ = self._prediction(home, away)
        return int(rng.poisson(home_mu)), int(rng.poisson(away_mu))

    def _prediction(
        self, home: str, away: str
    ) -> tuple[float, float, np.ndarray]:
        key = (home, away)
        if key not in self._prediction_cache:
            x = self._features(home, away)
            home_mu = float(
                np.clip(self.bundle.home_goals_model.predict(x)[0], 0.08, 5.0)
            )
            away_mu = float(
                np.clip(self.bundle.away_goals_model.predict(x)[0], 0.08, 5.0)
            )
            probabilities = self.bundle.outcome_model.predict_proba(x)[0]
            self._prediction_cache[key] = (home_mu, away_mu, probabilities)
        return self._prediction_cache[key]

    @staticmethod
    def _poisson_distribution(mean: float, max_goals: int = 10) -> np.ndarray:
        probabilities = np.asarray(
            [exp(-mean) * mean**goals / factorial(goals) for goals in range(max_goals + 1)]
        )
        probabilities[-1] += 1.0 - probabilities.sum()
        return probabilities

    def predict_match(self, home: str, away: str) -> MatchPrediction:
        home = canonical_team(home)
        away = canonical_team(away)
        home_mu, away_mu, _ = self._prediction(home, away)
        home_goals = self._poisson_distribution(home_mu)
        away_goals = self._poisson_distribution(away_mu)
        score_matrix = np.outer(home_goals, away_goals)
        away_win = float(np.triu(score_matrix, 1).sum())
        draw = float(np.trace(score_matrix))
        home_win = float(np.tril(score_matrix, -1).sum())
        predicted_home, predicted_away = np.unravel_index(
            int(score_matrix.argmax()), score_matrix.shape
        )
        return MatchPrediction(
            home_team=home,
            away_team=away,
            home_win_probability=home_win,
            draw_probability=draw,
            away_win_probability=away_win,
            expected_home_goals=home_mu,
            expected_away_goals=away_mu,
            predicted_home_score=int(predicted_home),
            predicted_away_score=int(predicted_away),
        )

    def predict_all_matchups(self) -> pd.DataFrame:
        teams = sorted(team for group in self.groups.values() for team in group)
        rows = [
            self.predict_match(home, away).as_record()
            for home in teams
            for away in teams
            if home != away
        ]
        return pd.DataFrame.from_records(rows)

    def knockout_winner(
        self, home: str, away: str, rng: np.random.Generator
    ) -> str:
        home_score, away_score = self.score(home, away, rng)
        if home_score != away_score:
            return home if home_score > away_score else away
        _, _, probabilities = self._prediction(home, away)
        away_win, _, home_win = probabilities
        decisive_total = home_win + away_win
        return home if rng.random() < home_win / decisive_total else away

    def group_table(
        self, teams: list[str], rng: np.random.Generator
    ) -> list[Standing]:
        table = {team: Standing(team) for team in teams}
        for home, away in combinations(teams, 2):
            home_score, away_score = self.score(home, away, rng)
            table[home].goals_for += home_score
            table[home].goals_against += away_score
            table[away].goals_for += away_score
            table[away].goals_against += home_score
            if home_score > away_score:
                table[home].points += 3
            elif away_score > home_score:
                table[away].points += 3
            else:
                table[home].points += 1
                table[away].points += 1
        return sorted(
            table.values(),
            key=lambda row: (
                row.points,
                row.goal_difference,
                row.goals_for,
                self._strength(row.team),
                rng.random(),
            ),
            reverse=True,
        )

    def run_once(self, rng: np.random.Generator) -> str:
        tables = [self.group_table(teams, rng) for teams in self.groups.values()]
        qualifiers = [row for table in tables for row in table[:2]]
        qualifiers.extend(
            sorted(
                (table[2] for table in tables),
                key=lambda row: (
                    row.points,
                    row.goal_difference,
                    row.goals_for,
                    self._strength(row.team),
                ),
                reverse=True,
            )[:8]
        )

        # Until the exact official third-place mapping is encoded, use
        # performance seeding. The approximation is explicit and replaceable.
        ranked = sorted(
            qualifiers,
            key=lambda row: (
                row.points,
                row.goal_difference,
                row.goals_for,
                self._strength(row.team),
            ),
            reverse=True,
        )
        field: list[str] = []
        for index in range(16):
            field.extend((ranked[index].team, ranked[-index - 1].team))
        while len(field) > 1:
            field = [
                self.knockout_winner(field[index], field[index + 1], rng)
                for index in range(0, len(field), 2)
            ]
        return field[0]

    def simulate(self, runs: int, seed: int = 26) -> pd.DataFrame:
        rng = np.random.default_rng(seed)
        winners = Counter(self.run_once(rng) for _ in range(runs))
        all_teams = sorted(team for teams in self.groups.values() for team in teams)
        rows = [
            {
                "team": team,
                "titles": winners.get(team, 0),
                "win_probability": winners.get(team, 0) / runs,
            }
            for team in all_teams
        ]
        return pd.DataFrame(rows).sort_values(
            ["win_probability", "team"], ascending=[False, True]
        ).reset_index(drop=True)
