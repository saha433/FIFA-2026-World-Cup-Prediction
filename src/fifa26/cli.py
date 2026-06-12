from __future__ import annotations

import argparse
import pickle
from pathlib import Path

from .features import apply_current_elo, load_completed_matches
from .simulation import WorldCupSimulator, load_groups
from .squads import build_default_squad_features
from .training import evaluate_world_cup, train_final, write_evaluation


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Train and run the FIFA 2026 model")
    parser.add_argument("--matches", default="archive-5/results.csv")
    parser.add_argument("--teams", default="archive-4/wc_2026_teams.csv")
    parser.add_argument("--elo", default="archive-3/elo_ratings_wc2026.csv")
    parser.add_argument("--output-dir", default="outputs")
    parser.add_argument("--runs", type=int, default=20_000)
    parser.add_argument("--seed", type=int, default=26)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    matches = load_completed_matches(args.matches)
    bundle, feature_frame = train_final(matches)
    elo_teams_updated = apply_current_elo(bundle.states, args.elo)
    metrics = {
        2018: evaluate_world_cup(feature_frame, 2018),
        2022: evaluate_world_cup(feature_frame, 2022),
    }
    write_evaluation(metrics, output_dir / "backtest_metrics.csv")
    with (output_dir / "model.pkl").open("wb") as handle:
        pickle.dump(bundle, handle)

    groups = load_groups(args.teams)
    baseline = WorldCupSimulator(bundle, groups).simulate(args.runs, args.seed)
    baseline.to_csv(output_dir / "winner_probabilities_baseline.csv", index=False)

    squad_features = build_default_squad_features(Path.cwd())
    squad_features.to_csv(output_dir / "squad_features.csv", index=False)
    adjustments = dict(
        zip(squad_features["team"], squad_features["squad_elo_adjustment"])
    )
    simulator = WorldCupSimulator(bundle, groups, elo_adjustments=adjustments)
    predictions = simulator.simulate(args.runs, args.seed)
    predictions.to_csv(output_dir / "winner_probabilities.csv", index=False)
    simulator.predict_all_matchups().to_csv(
        output_dir / "match_predictions.csv", index=False
    )

    print("Chronological World Cup backtests")
    for year, result in metrics.items():
        print(
            f"{year}: accuracy={result['accuracy']:.3f}, "
            f"log_loss={result['log_loss']:.3f} "
            f"(baseline={result['baseline_log_loss']:.3f})"
        )
    print(f"Current Elo anchor applied to {elo_teams_updated} teams.")
    print(f"\n2026 squad-aware title probabilities ({args.runs:,} simulations)")
    print(predictions.head(15).to_string(index=False, formatters={
        "win_probability": lambda value: f"{value:.2%}"
    }))


if __name__ == "__main__":
    main()
