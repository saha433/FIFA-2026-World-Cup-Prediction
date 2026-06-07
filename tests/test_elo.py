from fifa26.features import TeamState, apply_current_elo


def test_future_dated_elo_rows_are_ignored() -> None:
    states = {"Spain": TeamState(elo=1500)}

    updated = apply_current_elo(states, "archive-3/elo_ratings_wc2026.csv")

    assert updated >= 1
    assert states["Spain"].elo == 2165

