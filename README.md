# FIFA 2026 ML Predictor

This project trains leakage-safe football models on historical international
matches and estimates each 2026 World Cup team's title probability through
Monte Carlo simulation.

## Current data usage

- `archive-5/results.csv`: primary match history after unplayed rows are removed
- `archive-6/all_matches.csv`: secondary source; not used for outcome training
- `archive-5/shootouts.csv`: available for the next penalty-model iteration
- `archive-3/elo_ratings_wc2026.csv`: May 27, 2026 current-strength anchor
- `archive-7/`: historical FIFA ranking snapshots
- `archive-8/`: current top-five-league player statistics
- `archive-9/`: worldwide EAFC26 player ratings
- `archive-10/`: Transfermarkt profiles and market values
- `archive-11/`: current eight-league player performance
- `archive/train.csv` and `archive/test.csv`: tournament-level supplementary data
- `archive-4/wc_2026_teams.csv`: 2026 groups

Archive 6 is not used as the primary source because its World Cup matches are
usually ordered with the winner first, which would create a false home-team
signal. Archive 5 preserves normal home/away ordering.

The squad layer builds a position-balanced starting XI, 26-player depth,
elite-player count, market-value depth and current club-performance score. It
translates the combined score into a conservative, capped Elo adjustment.

The first implemented model starts with match history. It creates
pre-match Elo and rolling-form features, trains gradient-boosted outcome and
Poisson goal models, backtests on the 2018 and 2022 World Cups, and simulates
the 2026 tournament.

## Run

```bash
source .venv/bin/activate
pip install -e ".[dev]"
fifa26 --runs 20000
pytest
```

Outputs are written to:

- `outputs/backtest_metrics.csv`
- `outputs/winner_probabilities.csv`
- `outputs/winner_probabilities_baseline.csv`
- `outputs/squad_features.csv`
- `outputs/model.pkl`

## Dashboard

Generate the dashboard data after each model run:

```bash
python dashboard/generate_data.py
python -m http.server 4173 -d dashboard
```

Then open `http://localhost:4173`.

The dashboard includes title probabilities, baseline comparison, full rankings,
squad strength, group views, team detail panels and model backtest results.

## Current limitations

- The supplied 2026 fixture file contains errors, so group pairings are
  generated from the group membership file.
- Knockout qualification currently uses performance seeding rather than FIFA's
  exact third-place combination mapping.
- Squad features are current-only and therefore cannot be evaluated in the
  historical World Cup backtests without equivalent historical player data.
- Injury data is not used because the supplied archive has no new injury start
  dates after December 2025 and is not reliable for June 2026 availability.
- Predictions should be refreshed after final squads, injuries and the final
  pre-tournament matches are available.
# FIFA-2026-World-Cup-Prediction
