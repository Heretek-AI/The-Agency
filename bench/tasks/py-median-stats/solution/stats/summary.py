def median(values):
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2 == 0:
        return (ordered[mid - 1] + ordered[mid]) / 2
    return ordered[mid]


def summarize(values):
    if not values:
        raise ValueError("values must not be empty")
    return {
        "count": len(values),
        "min": min(values),
        "max": max(values),
        "median": median(values),
    }
