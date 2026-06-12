from __future__ import annotations

import json
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dashboard" / "data.json"


def main() -> None:
    prediction = pd.read_csv(ROOT / "outputs/winner_probabilities.csv")
    baseline = pd.read_csv(ROOT / "outputs/winner_probabilities_baseline.csv")
    squads = pd.read_csv(ROOT / "outputs/squad_features.csv")
    teams = pd.read_csv(ROOT / "archive-4/wc_2026_teams.csv")
    metrics = pd.read_csv(ROOT / "outputs/backtest_metrics.csv")
    match_predictions = pd.read_csv(ROOT / "outputs/match_predictions.csv")
    elo = pd.read_csv(ROOT / "archive-3/elo_ratings_wc2026.csv")

    teams["team"] = teams["team"].replace(
        {"USA": "United States", "Türkiye": "Turkey", "Czechia": "Czech Republic"}
    )
    elo["country"] = elo["country"].replace({"Czechia": "Czech Republic"})
    elo["snapshot_date"] = pd.to_datetime(elo["snapshot_date"])
    elo = (
        elo[elo["snapshot_date"] <= pd.Timestamp("2026-06-07")]
        .sort_values("snapshot_date")
        .drop_duplicates("country", keep="last")
    )

    combined = (
        prediction.rename(
            columns={
                "win_probability": "probability",
                "titles": "simulated_titles",
            }
        )
        .merge(
            baseline[["team", "win_probability"]].rename(
                columns={"win_probability": "baseline_probability"}
            ),
            on="team",
        )
        .merge(squads, on="team")
        .merge(
            teams[
                [
                    "team",
                    "group",
                    "confederation",
                    "fifa_rank",
                    "coach",
                    "best_wc_result",
                ]
            ],
            on="team",
        )
        .merge(
            elo[["country", "rank", "rating"]].rename(
                columns={"country": "team", "rank": "elo_rank", "rating": "elo"}
            ),
            on="team",
            how="left",
        )
        .sort_values("probability", ascending=False)
    )
    combined["rank"] = range(1, len(combined) + 1)
    combined["change"] = combined["probability"] - combined["baseline_probability"]

    numeric_columns = combined.select_dtypes(include="number").columns
    combined[numeric_columns] = combined[numeric_columns].round(6)
    prediction_numeric = match_predictions.select_dtypes(include="number").columns
    match_predictions[prediction_numeric] = match_predictions[prediction_numeric].round(6)
    matchup_payload = {
        f"{row.home_team}|{row.away_team}": {
            "home_win": row.home_win_probability,
            "draw": row.draw_probability,
            "away_win": row.away_win_probability,
            "home_xg": row.expected_home_goals,
            "away_xg": row.expected_away_goals,
            "home_score": row.predicted_home_score,
            "away_score": row.predicted_away_score,
            "outcome": row.predicted_outcome,
        }
        for row in match_predictions.itertuples(index=False)
    }

    payload = {
        "generated": "2026-06-07",
        "simulations": int(combined["simulated_titles"].sum()),
        "teams": json.loads(combined.to_json(orient="records")),
        "backtests": json.loads(metrics.round(6).to_json(orient="records")),
        "match_predictions": matchup_payload,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT} with {len(combined)} teams")


if __name__ == "__main__":
    main()
