import pandas as pd

from fifa26.features import build_match_features, canonical_team


def test_aliases_are_canonicalized() -> None:
    assert canonical_team("USA") == "United States"
    assert canonical_team("Türkiye") == "Turkey"


def test_features_use_only_previous_matches() -> None:
    matches = pd.DataFrame(
        [
            {
                "date": "2020-01-01",
                "home_team": "A",
                "away_team": "B",
                "home_score": 3,
                "away_score": 0,
                "tournament": "Friendly",
                "neutral": False,
            },
            {
                "date": "2020-02-01",
                "home_team": "A",
                "away_team": "B",
                "home_score": 0,
                "away_score": 0,
                "tournament": "Friendly",
                "neutral": False,
            },
        ]
    )

    features, _ = build_match_features(matches)

    assert features.iloc[0]["win_rate_diff"] == 0
    assert features.iloc[1]["win_rate_diff"] > 0

