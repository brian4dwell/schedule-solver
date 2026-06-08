SHORT_SHIFT_TYPES = [
    "first_half",
    "second_half",
    "short_shift",
]


def shift_request_units_for_shift_type(shift_type: str) -> int:
    shift_is_short = shift_type in SHORT_SHIFT_TYPES

    if shift_is_short:
        return 1

    return 2


def shift_units_text(units: int) -> str:
    whole_shifts = units // 2
    has_half_shift = units % 2 == 1

    if has_half_shift:
        text = f"{whole_shifts}.5"
        return text

    text = str(whole_shifts)
    return text
