def median(values):
    values.sort()
    mid = len(values) // 2
    return values[mid]


def summarize(values):
    if not values:
        raise ValueError("values must not be empty")
    return {
        "count": len(values),
        "min": min(values),
        "max": max(values),
        "median": median(values),
    }
