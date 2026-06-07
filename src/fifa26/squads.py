from __future__ import annotations

import re
import unicodedata
from pathlib import Path

import numpy as np
import pandas as pd

from .features import canonical_team


EA_NATION_ALIASES = {
    "Cape Verde Islands": "Cape Verde",
    "Congo DR": "DR Congo",
    "Côte d'Ivoire": "Ivory Coast",
    "Holland": "Netherlands",
    "Korea Republic": "South Korea",
}

TM_CITIZENSHIP_ALIASES = {
    "Ivory Coast": "Cote d'Ivoire",
    "South Korea": "Korea, South",
    "Turkey": "Türkiye",
}

POSITION_GROUPS = {
    "GK": "goalkeeper",
    "CB": "defender",
    "LB": "defender",
    "RB": "defender",
    "LWB": "defender",
    "RWB": "defender",
    "CDM": "midfielder",
    "CM": "midfielder",
    "CAM": "midfielder",
    "LM": "midfielder",
    "RM": "midfielder",
    "LW": "attacker",
    "RW": "attacker",
    "CF": "attacker",
    "ST": "attacker",
}


def normalize_player_name(value: object) -> str:
    text = re.sub(r"\s*\(\d+\)$", "", str(value))
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _filled_mean(values: pd.Series, slots: int, replacement: float = 60.0) -> float:
    selected = values.dropna().astype(float).nlargest(slots).tolist()
    selected.extend([replacement] * (slots - len(selected)))
    return float(np.mean(selected))


def _position_balanced_xi(players: pd.DataFrame) -> float:
    required = {
        "goalkeeper": 1,
        "defender": 4,
        "midfielder": 3,
        "attacker": 3,
    }
    ratings: list[float] = []
    for group, count in required.items():
        selected = (
            players.loc[players["position_group"] == group, "OVR"]
            .dropna()
            .astype(float)
            .nlargest(count)
            .tolist()
        )
        selected.extend([60.0] * (count - len(selected)))
        ratings.extend(selected)
    return float(np.mean(ratings))


def _zscore(series: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(series, errors="coerce")
    filled = numeric.fillna(numeric.median())
    std = float(filled.std(ddof=0))
    if std == 0:
        return pd.Series(0.0, index=series.index)
    return (filled - filled.mean()) / std


def _load_market_values(profiles_path: str, values_path: str) -> pd.DataFrame:
    profiles = pd.read_csv(
        profiles_path,
        usecols=[
            "player_id",
            "player_name",
            "citizenship",
            "date_of_birth",
            "current_club_name",
        ],
    )
    values = pd.read_csv(values_path)
    market = profiles.merge(values, on="player_id", how="inner")
    market["date_of_birth"] = pd.to_datetime(
        market["date_of_birth"], errors="coerce"
    )
    market["age"] = (
        pd.Timestamp("2026-06-07") - market["date_of_birth"]
    ).dt.days / 365.25
    market = market[
        market["age"].between(16, 42)
        & ~market["current_club_name"].isin(["Retired", "Without Club"])
        & (market["value"] > 0)
    ].copy()
    market["name_key"] = market["player_name"].map(normalize_player_name)
    return market


def _load_current_form(profiles_path: str, stats_path: str) -> pd.DataFrame:
    profiles = pd.read_csv(profiles_path)
    stats = pd.read_csv(stats_path)
    form = profiles[["player_id", "name"]].merge(stats, on="player_id", how="inner")
    form["name_key"] = form["name"].map(normalize_player_name)
    form = form.sort_values(["minutes_played", "rating"], ascending=False)
    return form.drop_duplicates("name_key")


def build_squad_features(
    teams_path: str,
    ea_path: str,
    tm_profiles_path: str,
    tm_latest_value_path: str,
    form_profiles_path: str,
    form_stats_path: str,
) -> pd.DataFrame:
    teams = pd.read_csv(teams_path)
    teams["team"] = teams["team"].map(canonical_team)

    ea = pd.read_csv(ea_path)
    ea["team"] = ea["Nation"].replace(EA_NATION_ALIASES).map(canonical_team)
    ea["name_key"] = ea["Name"].map(normalize_player_name)
    ea["position_group"] = ea["Position"].map(POSITION_GROUPS).fillna("midfielder")

    market = _load_market_values(tm_profiles_path, tm_latest_value_path)
    market_by_name = (
        market.sort_values("value", ascending=False)
        .drop_duplicates("name_key")
        [["name_key", "value"]]
    )
    ea = ea.merge(market_by_name, on="name_key", how="left")

    form = _load_current_form(form_profiles_path, form_stats_path)
    ea = ea.merge(
        form[["name_key", "minutes_played", "rating"]],
        on="name_key",
        how="left",
    )

    records: list[dict[str, float | int | str]] = []
    for team in teams["team"]:
        players = ea[ea["team"] == team].copy()
        xi_rating = _position_balanced_xi(players)
        depth_rating = _filled_mean(players["OVR"], 26)
        elite_players = int((players["OVR"] >= 85).sum())
        fc_coverage = min(len(players), 26) / 26.0

        tm_country = TM_CITIZENSHIP_ALIASES.get(team, team)
        citizenship = market["citizenship"].fillna("")
        primary = (citizenship == tm_country) | citizenship.str.startswith(
            tm_country + "  "
        )
        country_market = market[primary]
        market_top26 = float(
            country_market["value"].nlargest(26).sum()
        )

        top_players = players.nlargest(26, "OVR")
        form_players = top_players[
            top_players["rating"].notna() & (top_players["minutes_played"] >= 450)
        ]
        if form_players.empty:
            form_rating = np.nan
            form_coverage = 0.0
        else:
            weights = np.sqrt(form_players["minutes_played"].astype(float))
            form_rating = float(np.average(form_players["rating"], weights=weights))
            form_coverage = len(form_players) / 26.0

        records.append(
            {
                "team": team,
                "fc26_xi_rating": xi_rating,
                "fc26_depth_rating": depth_rating,
                "elite_players": elite_players,
                "fc26_coverage": fc_coverage,
                "market_value_top26_eur": market_top26,
                "current_form_rating": form_rating,
                "current_form_coverage": form_coverage,
            }
        )

    result = pd.DataFrame(records)
    result["market_log"] = np.log1p(result["market_value_top26_eur"])
    result["xi_z"] = _zscore(result["fc26_xi_rating"])
    result["depth_z"] = _zscore(result["fc26_depth_rating"])
    result["elite_z"] = _zscore(result["elite_players"])
    result["market_z"] = _zscore(result["market_log"])
    result["form_z"] = _zscore(result["current_form_rating"])
    result["fc26_reliability"] = (result["fc26_coverage"] / 0.75).clip(0, 1)

    # FC26 is the consistent worldwide backbone. Market value and current form
    # add smaller independent signals. Missing EA coverage is neutral rather
    # than negative, because licensing gaps are not evidence of a weak squad.
    result["squad_score_z"] = (
        0.40 * result["xi_z"] * result["fc26_reliability"]
        + 0.30 * result["depth_z"] * result["fc26_reliability"]
        + 0.10 * result["elite_z"] * result["fc26_reliability"]
        + 0.15 * result["market_z"]
        + 0.05 * result["form_z"] * result["current_form_coverage"].clip(0, 1)
    )
    result["squad_elo_adjustment"] = (
        35.0 * result["squad_score_z"]
    ).clip(-80.0, 80.0)
    return result.sort_values("squad_score_z", ascending=False).reset_index(drop=True)


def build_default_squad_features(root: Path) -> pd.DataFrame:
    return build_squad_features(
        str(root / "archive-4/wc_2026_teams.csv"),
        str(root / "archive-9/EAFC26-Men.csv"),
        str(root / "archive-10/player_profiles/player_profiles.csv"),
        str(
            root
            / "archive-10/player_latest_market_value/player_latest_market_value.csv"
        ),
        str(root / "archive-11/all_player_profiles.csv"),
        str(root / "archive-11/all_player_stats.csv"),
    )
