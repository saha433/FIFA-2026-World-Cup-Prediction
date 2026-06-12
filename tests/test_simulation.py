import pickle

import pytest

from fifa26.simulation import WorldCupSimulator, load_groups


def test_loads_twelve_groups() -> None:
    groups = load_groups("archive-4/wc_2026_teams.csv")

    assert len(groups) == 12
    assert all(len(teams) == 4 for teams in groups.values())


def test_match_prediction_probabilities_and_scoreline() -> None:
    with open("outputs/model.pkl", "rb") as handle:
        bundle = pickle.load(handle)
    groups = load_groups("archive-4/wc_2026_teams.csv")
    simulator = WorldCupSimulator(bundle, groups)

    prediction = simulator.predict_match("Spain", "France")

    assert (
        prediction.home_win_probability
        + prediction.draw_probability
        + prediction.away_win_probability
    ) == pytest.approx(1.0)
    assert prediction.predicted_outcome in {"home", "draw", "away"}
    assert prediction.predicted_home_score >= 0
    assert prediction.predicted_away_score >= 0
