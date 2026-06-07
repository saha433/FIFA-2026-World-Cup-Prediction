from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.metrics import accuracy_score, log_loss, mean_poisson_deviance

from .features import FEATURE_COLUMNS, TeamState, as_matrix, build_match_features


@dataclass(slots=True)
class ModelBundle:
    outcome_model: HistGradientBoostingClassifier
    home_goals_model: HistGradientBoostingRegressor
    away_goals_model: HistGradientBoostingRegressor
    states: dict[str, TeamState]
    feature_columns: list[str]


def make_models() -> tuple[
    HistGradientBoostingClassifier,
    HistGradientBoostingRegressor,
    HistGradientBoostingRegressor,
]:
    outcome = HistGradientBoostingClassifier(
        learning_rate=0.06,
        max_iter=220,
        max_leaf_nodes=15,
        l2_regularization=1.5,
        random_state=26,
    )
    home_goals = HistGradientBoostingRegressor(
        loss="poisson",
        learning_rate=0.05,
        max_iter=180,
        max_leaf_nodes=15,
        l2_regularization=2.0,
        random_state=26,
    )
    away_goals = HistGradientBoostingRegressor(
        loss="poisson",
        learning_rate=0.05,
        max_iter=180,
        max_leaf_nodes=15,
        l2_regularization=2.0,
        random_state=27,
    )
    return outcome, home_goals, away_goals


def fit_models(frame: pd.DataFrame) -> tuple[
    HistGradientBoostingClassifier,
    HistGradientBoostingRegressor,
    HistGradientBoostingRegressor,
]:
    outcome, home_goals, away_goals = make_models()
    x = as_matrix(frame)
    outcome.fit(x, frame["outcome"])
    home_goals.fit(x, frame["home_score"])
    away_goals.fit(x, frame["away_score"])
    return outcome, home_goals, away_goals


def evaluate_world_cup(frame: pd.DataFrame, year: int) -> dict[str, float]:
    start = pd.Timestamp(f"{year}-01-01")
    test = frame[
        (frame["date"].dt.year == year)
        & frame["tournament"].str.contains("World Cup", case=False, regex=False)
        & ~frame["tournament"].str.contains(
            "qual", case=False, regex=False
        )
    ]
    train = frame[
        (frame["date"] < test["date"].min())
        & (frame["date"] >= start - pd.DateOffset(years=18))
    ]
    if test.empty:
        raise ValueError(f"No World Cup matches found for {year}")
    outcome, home_goals, away_goals = fit_models(train)
    x_test = as_matrix(test)
    probabilities = outcome.predict_proba(x_test)
    predictions = outcome.predict(x_test)
    class_priors = (
        train["outcome"]
        .value_counts(normalize=True)
        .reindex([0, 1, 2], fill_value=0.0)
        .to_numpy()
    )
    prior_probabilities = [class_priors] * len(test)
    home_mu = home_goals.predict(x_test).clip(0.05)
    away_mu = away_goals.predict(x_test).clip(0.05)
    return {
        "matches": float(len(test)),
        "accuracy": float(accuracy_score(test["outcome"], predictions)),
        "log_loss": float(log_loss(test["outcome"], probabilities, labels=[0, 1, 2])),
        "baseline_accuracy": float(
            accuracy_score(
                test["outcome"],
                [int(class_priors.argmax())] * len(test),
            )
        ),
        "baseline_log_loss": float(
            log_loss(test["outcome"], prior_probabilities, labels=[0, 1, 2])
        ),
        "home_goal_deviance": float(
            mean_poisson_deviance(test["home_score"], home_mu)
        ),
        "away_goal_deviance": float(
            mean_poisson_deviance(test["away_score"], away_mu)
        ),
    }


def train_final(matches: pd.DataFrame) -> tuple[ModelBundle, pd.DataFrame]:
    features, states = build_match_features(matches)
    training = features[features["date"] >= pd.Timestamp("2000-01-01")]
    outcome, home_goals, away_goals = fit_models(training)
    return (
        ModelBundle(
            outcome_model=outcome,
            home_goals_model=home_goals,
            away_goals_model=away_goals,
            states=states,
            feature_columns=FEATURE_COLUMNS,
        ),
        features,
    )


def write_evaluation(metrics: dict[int, dict[str, float]], path: Path) -> None:
    rows = [{"world_cup": year, **values} for year, values in metrics.items()]
    pd.DataFrame(rows).to_csv(path, index=False)
