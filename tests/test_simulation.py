from fifa26.simulation import load_groups


def test_loads_twelve_groups() -> None:
    groups = load_groups("archive-4/wc_2026_teams.csv")

    assert len(groups) == 12
    assert all(len(teams) == 4 for teams in groups.values())

