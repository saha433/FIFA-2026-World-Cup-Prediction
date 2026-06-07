from fifa26.squads import build_default_squad_features


def test_squad_features_cover_all_teams() -> None:
    features = build_default_squad_features(__import__("pathlib").Path.cwd())

    assert len(features) == 48
    assert features["team"].nunique() == 48
    assert features["squad_elo_adjustment"].between(-80, 80).all()


def test_france_has_elite_squad_depth() -> None:
    features = build_default_squad_features(__import__("pathlib").Path.cwd())
    france = features.set_index("team").loc["France"]

    assert france["elite_players"] >= 5
    assert france["fc26_depth_rating"] >= 80

