import re
import unicodedata


def normalize_text(text):
    if not text:
        return ""

    text = str(text).lower().strip()

    text = unicodedata.normalize("NFD", text)

    text = "".join(c
        for c in text
        if unicodedata.category(c) != "Mn"
    )

    text = re.sub(r"\s+", " ", text)

    return text.strip()


def strong_normalize(text):
    return normalize_text(text)


def split_pipe(value):
    if not value:
        return []

    return [
        v.strip()
        for v in str(value).split("|")
        if v.strip()
    ]


def normalized_keys(value):
    if not value:
        return set()

    return {
        normalize_text(token)
        for token in str(value).split("|")
        if token.strip()
    }


def unique_join(parts, sep=" | ", exclude=None):
    seen = set(exclude or [])
    result = []

    for part in parts:
        if not part:
            continue

        tokens = [
            t.strip()
            for t in str(part).split("|")
            if t.strip()
        ]

        for token in tokens:
            normalized = normalize_text(token)

            if normalized in seen:
                continue

            seen.add(normalized)
            result.append(token)

    return sep.join(result)